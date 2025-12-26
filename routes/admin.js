const express = require('express');
const router = express.Router();
const bcrypt = require('bcryptjs');
const { getDatabase } = require('../services/database');

// Middleware to check admin auth
function requireAdminAuth(req, res, next) {
    if (!req.session.isAdmin) {
        return res.redirect('/admin/login');
    }
    next();
}

// Login page
router.get('/login', (req, res) => {
    res.render('admin/login', {
        title: 'Admin Login',
        error: req.query.error
    });
});

// Process login
router.post('/login', (req, res) => {
    const { password } = req.body;
    const adminPassword = process.env.ADMIN_PASSWORD || 'admin123';

    if (password === adminPassword) {
        req.session.isAdmin = true;
        res.redirect('/admin/dashboard');
    } else {
        res.redirect('/admin/login?error=Invalid password');
    }
});

// Logout
router.get('/logout', (req, res) => {
    req.session.destroy();
    res.redirect('/admin/login');
});

// Dashboard
router.get('/dashboard', requireAdminAuth, (req, res) => {
    const db = getDatabase();

    // Get stats
    const leadStats = db.prepare(`
        SELECT
            COUNT(*) as total,
            SUM(CASE WHEN readiness_level = 'green' THEN 1 ELSE 0 END) as green,
            SUM(CASE WHEN readiness_level = 'yellow' THEN 1 ELSE 0 END) as yellow,
            SUM(CASE WHEN readiness_level = 'red' THEN 1 ELSE 0 END) as red,
            SUM(CASE WHEN DATE(created_at) = DATE('now') THEN 1 ELSE 0 END) as today
        FROM leads
    `).get();

    const agentCount = db.prepare('SELECT COUNT(*) as count FROM agents').get();

    // Recent leads
    const recentLeads = db.prepare(`
        SELECT l.*, a.first_name as agent_first_name, a.last_name as agent_last_name
        FROM leads l
        LEFT JOIN agents a ON l.agent_id = a.id
        ORDER BY l.created_at DESC
        LIMIT 10
    `).all();

    res.render('admin/dashboard', {
        title: 'Admin Dashboard',
        leadStats,
        agentCount: agentCount.count,
        recentLeads
    });
});

// All leads
router.get('/leads', requireAdminAuth, (req, res) => {
    const db = getDatabase();

    const leads = db.prepare(`
        SELECT l.*, a.first_name as agent_first_name, a.last_name as agent_last_name
        FROM leads l
        LEFT JOIN agents a ON l.agent_id = a.id
        ORDER BY l.created_at DESC
    `).all();

    res.render('admin/leads', {
        title: 'All Leads',
        leads
    });
});

// Lead detail
router.get('/leads/:id', requireAdminAuth, (req, res) => {
    const db = getDatabase();

    const lead = db.prepare(`
        SELECT l.*, a.first_name as agent_first_name, a.last_name as agent_last_name,
               a.email as agent_email, a.phone as agent_phone
        FROM leads l
        LEFT JOIN agents a ON l.agent_id = a.id
        WHERE l.id = ?
    `).get(req.params.id);

    if (!lead) {
        return res.status(404).render('error', {
            title: 'Not Found',
            message: 'Lead not found.'
        });
    }

    // Parse JSON fields
    let actionItems = [];
    let targetCounties = [];
    let downPaymentSources = [];
    try {
        actionItems = JSON.parse(lead.action_items || '[]');
        targetCounties = JSON.parse(lead.target_counties || '[]');
        downPaymentSources = JSON.parse(lead.down_payment_sources || '[]');
    } catch (e) {}

    // Get uploaded documents
    const documents = db.prepare('SELECT * FROM documents WHERE lead_id = ? ORDER BY uploaded_at DESC').all(lead.id);

    res.render('admin/lead-detail', {
        title: `${lead.first_name} ${lead.last_name}`,
        lead,
        actionItems,
        targetCounties,
        downPaymentSources,
        documents
    });
});

// MISMO XML download
router.get('/leads/:id/mismo', requireAdminAuth, (req, res) => {
    const db = getDatabase();
    const lead = db.prepare('SELECT * FROM leads WHERE id = ?').get(req.params.id);

    if (!lead) {
        return res.status(404).json({ error: 'Lead not found' });
    }

    const xml = generateMISMO(lead);
    res.setHeader('Content-Type', 'application/xml');
    res.setHeader('Content-Disposition', `attachment; filename="mismo-${lead.id}.xml"`);
    res.send(xml);
});

// Agents list
router.get('/agents', requireAdminAuth, (req, res) => {
    const db = getDatabase();
    const agents = db.prepare(`
        SELECT a.*,
               (SELECT COUNT(*) FROM leads WHERE agent_id = a.id) as lead_count
        FROM agents a
        ORDER BY a.created_at DESC
    `).all();

    res.render('admin/agents', {
        title: 'Manage Agents',
        agents,
        success: req.query.success
    });
});

// Create agent
router.post('/agents', requireAdminAuth, async (req, res) => {
    const db = getDatabase();
    const data = req.body;

    // Generate slug from name
    const slug = `${data.first_name}-${data.last_name}`.toLowerCase().replace(/[^a-z0-9]/g, '-');

    // Hash password
    const passwordHash = await bcrypt.hash(data.password, 10);

    try {
        db.prepare(`
            INSERT INTO agents (slug, first_name, last_name, email, phone, brokerage, password_hash)
            VALUES (?, ?, ?, ?, ?, ?, ?)
        `).run(slug, data.first_name, data.last_name, data.email, data.phone, data.brokerage, passwordHash);

        res.redirect('/admin/agents?success=Agent created');
    } catch (error) {
        console.error('Error creating agent:', error);
        res.redirect('/admin/agents?error=Failed to create agent');
    }
});

// Agent detail
router.get('/agents/:id', requireAdminAuth, (req, res) => {
    const db = getDatabase();
    const agent = db.prepare('SELECT * FROM agents WHERE id = ?').get(req.params.id);

    if (!agent) {
        return res.status(404).render('error', {
            title: 'Not Found',
            message: 'Agent not found.'
        });
    }

    const leads = db.prepare(`
        SELECT * FROM leads WHERE agent_id = ? ORDER BY created_at DESC
    `).all(agent.id);

    res.render('admin/agent-detail', {
        title: `${agent.first_name} ${agent.last_name}`,
        agent,
        leads
    });
});

// Update agent
router.post('/agents/:id', requireAdminAuth, (req, res) => {
    const db = getDatabase();
    const data = req.body;

    db.prepare(`
        UPDATE agents SET
            first_name = ?,
            last_name = ?,
            email = ?,
            phone = ?,
            brokerage = ?,
            website = ?,
            bio = ?,
            updated_at = CURRENT_TIMESTAMP
        WHERE id = ?
    `).run(
        data.first_name,
        data.last_name,
        data.email,
        data.phone,
        data.brokerage,
        data.website,
        data.bio,
        req.params.id
    );

    res.redirect('/admin/agents?success=Agent updated');
});

// Delete agent
router.delete('/agents/:id', requireAdminAuth, (req, res) => {
    const db = getDatabase();

    // Unlink leads from agent
    db.prepare('UPDATE leads SET agent_id = NULL WHERE agent_id = ?').run(req.params.id);

    // Delete agent
    db.prepare('DELETE FROM agents WHERE id = ?').run(req.params.id);

    res.json({ success: true });
});

// MISMO XML generation
function generateMISMO(lead) {
    const escapeXml = (str) => {
        if (!str) return '';
        return String(str)
            .replace(/&/g, '&amp;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;')
            .replace(/'/g, '&apos;');
    };

    const getResidencyMonths = (timeAtAddress) => {
        const map = {
            'Less than 1 year': 6,
            '1-2 years': 18,
            '2+ years': 36
        };
        return map[timeAtAddress] || 12;
    };

    const getEmploymentMonths = (yearsAtJob) => {
        const map = {
            'Less than 1 year': 6,
            '1-2 years': 18,
            '2-5 years': 42,
            '5+ years': 72
        };
        return map[yearsAtJob] || 12;
    };

    const mapEmploymentType = (type) => {
        const map = {
            'W-2 Employee (traditional job)': 'Current',
            'Self-Employed': 'SelfEmployed',
            '1099 Contractor': 'SelfEmployed',
            'Retired': 'Retired',
            'Other': 'Other'
        };
        return map[type] || 'Other';
    };

    const mapCitizenshipType = (status) => {
        const map = {
            'U.S. Citizen': 'USCitizen',
            'Permanent Resident': 'PermanentResidentAlien',
            'Non-Permanent Resident': 'NonPermanentResidentAlien',
            'Other': 'Unknown'
        };
        return map[status] || 'Unknown';
    };

    const mapPropertyType = (type) => {
        const map = {
            'Single Family Home': 'SingleFamily',
            'Townhouse': 'Townhouse',
            'Condo': 'Condominium',
            'Multi-Family (2-4 units)': 'TwoToFourUnitProperty',
            'Manufactured Home': 'ManufacturedHousing'
        };
        return map[type] || 'SingleFamily';
    };

    const mapPropertyUse = (use) => {
        const map = {
            'Primary Residence': 'PrimaryResidence',
            'Second Home': 'SecondHome',
            'Investment Property': 'Investment'
        };
        return map[use] || 'PrimaryResidence';
    };

    const debtMidpoints = {
        'Under $200': 100,
        '$200 - $499': 350,
        '$500 - $799': 650,
        '$800 - $1,199': 1000,
        '$1,200 - $1,799': 1500,
        '$1,800 - $2,499': 2150,
        '$2,500+': 3000
    };

    // Calculate total monthly debt
    const monthlyDebt = lead.monthly_debt_amount || debtMidpoints[lead.monthly_debt_payments] || 500;

    // Build co-borrower section if applicable
    let coborrowerSection = '';
    if (lead.has_coborrower) {
        coborrowerSection = `
            <PARTY>
              <INDIVIDUAL>
                <NAME>
                  <FirstName>${escapeXml(lead.coborrower_first_name)}</FirstName>
                  <LastName>${escapeXml(lead.coborrower_last_name)}</LastName>
                </NAME>
              </INDIVIDUAL>
              <ROLES>
                <ROLE>
                  <BORROWER>
                    <CURRENT_INCOME>
                      <CURRENT_INCOME_ITEMS>
                        <CURRENT_INCOME_ITEM>
                          <CURRENT_INCOME_ITEM_DETAIL>
                            <CurrentIncomeMonthlyTotalAmount>${Math.round((lead.coborrower_gross_annual_income || 0) / 12)}</CurrentIncomeMonthlyTotalAmount>
                            <IncomeType>Base</IncomeType>
                          </CURRENT_INCOME_ITEM_DETAIL>
                        </CURRENT_INCOME_ITEM>
                      </CURRENT_INCOME_ITEMS>
                    </CURRENT_INCOME>
                  </BORROWER>
                  <ROLE_DETAIL>
                    <PartyRoleType>Borrower</PartyRoleType>
                  </ROLE_DETAIL>
                </ROLE>
              </ROLES>
              <CONTACT_POINTS>
                <CONTACT_POINT>
                  <CONTACT_POINT_EMAIL>
                    <ContactPointEmailValue>${escapeXml(lead.coborrower_email)}</ContactPointEmailValue>
                  </CONTACT_POINT_EMAIL>
                </CONTACT_POINT>
              </CONTACT_POINTS>
            </PARTY>`;
    }

    // Build previous employer section if applicable
    let previousEmployerSection = '';
    if (lead.previous_employer_name) {
        previousEmployerSection = `
                      <EMPLOYER>
                        <LEGAL_ENTITY>
                          <LEGAL_ENTITY_DETAIL>
                            <FullName>${escapeXml(lead.previous_employer_name)}</FullName>
                          </LEGAL_ENTITY_DETAIL>
                        </LEGAL_ENTITY>
                        <EMPLOYMENT>
                          <EmploymentStatusType>Previous</EmploymentStatusType>
                          <EmploymentMonthsOnJobCount>${getEmploymentMonths(lead.previous_employer_years)}</EmploymentMonthsOnJobCount>
                        </EMPLOYMENT>
                      </EMPLOYER>`;
    }

    // Build subject property section if applicable
    let subjectPropertySection = '';
    if (lead.property_address || lead.property_type) {
        subjectPropertySection = `
          <COLLATERALS>
            <COLLATERAL>
              <SUBJECT_PROPERTY>
                <ADDRESS>
                  <AddressLineText>${escapeXml(lead.property_address || '')}</AddressLineText>
                </ADDRESS>
                <PROPERTY_DETAIL>
                  <PropertyUsageType>${mapPropertyUse(lead.property_use)}</PropertyUsageType>
                  <PropertyEstateType>FeeSimple</PropertyEstateType>
                </PROPERTY_DETAIL>
              </SUBJECT_PROPERTY>
            </COLLATERAL>
          </COLLATERALS>`;
    }

    // Build assets section
    let assetsSection = `
          <ASSETS>
            <ASSET>
              <ASSET_DETAIL>
                <AssetType>CheckingAccount</AssetType>
              </ASSET_DETAIL>
              <ASSET_HOLDER>
                <ASSET_HOLDER_DETAIL>
                  <AssetCashOrMarketValueAmount>${lead.checking_balance || 0}</AssetCashOrMarketValueAmount>
                </ASSET_HOLDER_DETAIL>
              </ASSET_HOLDER>
            </ASSET>
            <ASSET>
              <ASSET_DETAIL>
                <AssetType>SavingsAccount</AssetType>
              </ASSET_DETAIL>
              <ASSET_HOLDER>
                <ASSET_HOLDER_DETAIL>
                  <AssetCashOrMarketValueAmount>${lead.savings_balance || lead.down_payment_saved || 0}</AssetCashOrMarketValueAmount>
                </ASSET_HOLDER_DETAIL>
              </ASSET_HOLDER>
            </ASSET>
            <ASSET>
              <ASSET_DETAIL>
                <AssetType>RetirementFund</AssetType>
              </ASSET_DETAIL>
              <ASSET_HOLDER>
                <ASSET_HOLDER_DETAIL>
                  <AssetCashOrMarketValueAmount>${lead.retirement_balance || 0}</AssetCashOrMarketValueAmount>
                </ASSET_HOLDER_DETAIL>
              </ASSET_HOLDER>
            </ASSET>${lead.other_assets_balance ? `
            <ASSET>
              <ASSET_DETAIL>
                <AssetType>Other</AssetType>
                <AssetTypeOtherDescription>${escapeXml(lead.other_assets_description || 'Other Assets')}</AssetTypeOtherDescription>
              </ASSET_DETAIL>
              <ASSET_HOLDER>
                <ASSET_HOLDER_DETAIL>
                  <AssetCashOrMarketValueAmount>${lead.other_assets_balance}</AssetCashOrMarketValueAmount>
                </ASSET_HOLDER_DETAIL>
              </ASSET_HOLDER>
            </ASSET>` : ''}
          </ASSETS>`;

    // Build liabilities section
    let liabilitiesSection = `
          <LIABILITIES>
            <LIABILITY_SUMMARY>
              <TotalMonthlyLiabilityPaymentAmount>${monthlyDebt}</TotalMonthlyLiabilityPaymentAmount>
            </LIABILITY_SUMMARY>${lead.alimony_amount ? `
            <LIABILITY>
              <LIABILITY_DETAIL>
                <LiabilityType>Alimony</LiabilityType>
                <LiabilityMonthlyPaymentAmount>${lead.alimony_amount}</LiabilityMonthlyPaymentAmount>
              </LIABILITY_DETAIL>
            </LIABILITY>` : ''}
          </LIABILITIES>`;

    return `<?xml version="1.0" encoding="UTF-8"?>
<MESSAGE xmlns="http://www.mismo.org/residential/2009/schemas">
  <ABOUT_VERSIONS>
    <ABOUT_VERSION>
      <DataVersionIdentifier>3.4</DataVersionIdentifier>
    </ABOUT_VERSION>
  </ABOUT_VERSIONS>
  <DEAL_SETS>
    <DEAL_SET>
      <DEALS>
        <DEAL>
          <PARTIES>
            <PARTY>
              <INDIVIDUAL>
                <NAME>
                  <FirstName>${escapeXml(lead.first_name)}</FirstName>
                  <LastName>${escapeXml(lead.last_name)}</LastName>
                </NAME>
                <CONTACT_POINTS>
                  <CONTACT_POINT>
                    <CONTACT_POINT_EMAIL>
                      <ContactPointEmailValue>${escapeXml(lead.email)}</ContactPointEmailValue>
                    </CONTACT_POINT_EMAIL>
                  </CONTACT_POINT>
                  <CONTACT_POINT>
                    <CONTACT_POINT_TELEPHONE>
                      <ContactPointTelephoneValue>${escapeXml(lead.phone)}</ContactPointTelephoneValue>
                    </CONTACT_POINT_TELEPHONE>
                  </CONTACT_POINT>
                </CONTACT_POINTS>
              </INDIVIDUAL>
              <ROLES>
                <ROLE>
                  <BORROWER>
                    <BORROWER_DETAIL>
                      <BorrowerBirthDate>${escapeXml(lead.date_of_birth || '')}</BorrowerBirthDate>
                      <CommunityPropertyStateResidentIndicator>false</CommunityPropertyStateResidentIndicator>
                      <DependentCount>0</DependentCount>
                      <SelfDeclaredMilitaryServiceIndicator>${lead.va_eligible === 'Yes' ? 'true' : 'false'}</SelfDeclaredMilitaryServiceIndicator>
                    </BORROWER_DETAIL>
                    <DECLARATION>
                      <BankruptcyIndicator>${lead.has_bankruptcy === 'Yes' ? 'true' : 'false'}</BankruptcyIndicator>
                      <CitizenshipResidencyType>${mapCitizenshipType(lead.citizenship_status)}</CitizenshipResidencyType>
                      <FirstTimeHomebuyerIndicator>${lead.first_time_buyer && lead.first_time_buyer.includes('Yes') ? 'true' : 'false'}</FirstTimeHomebuyerIndicator>
                      <HomeownerPastThreeYearsType>${lead.first_time_buyer && lead.first_time_buyer.includes('Yes') ? 'No' : 'Yes'}</HomeownerPastThreeYearsType>
                      <IntentToOccupyType>${lead.property_use === 'Primary Residence' ? 'Yes' : 'No'}</IntentToOccupyType>
                      <OutstandingJudgmentsIndicator>${lead.has_judgments_liens === 'Yes' ? 'true' : 'false'}</OutstandingJudgmentsIndicator>
                      <PartyToLawsuitIndicator>false</PartyToLawsuitIndicator>
                      <PresentlyDelinquentIndicator>false</PresentlyDelinquentIndicator>
                      <PropertyForeclosedPastSevenYearsIndicator>${lead.has_foreclosure === 'Yes' ? 'true' : 'false'}</PropertyForeclosedPastSevenYearsIndicator>
                      <AlimonyChildSupportObligationIndicator>${lead.pays_alimony_child_support === 'Yes' ? 'true' : 'false'}</AlimonyChildSupportObligationIndicator>
                    </DECLARATION>
                    <RESIDENCES>
                      <RESIDENCE>
                        <ADDRESS>
                          <AddressLineText>${escapeXml(lead.street_address)}</AddressLineText>
                          <CityName>${escapeXml(lead.city)}</CityName>
                          <StateCode>${escapeXml(lead.state)}</StateCode>
                          <PostalCode>${escapeXml(lead.zip)}</PostalCode>
                        </ADDRESS>
                        <RESIDENCE_DETAIL>
                          <BorrowerResidencyDurationMonthsCount>${getResidencyMonths(lead.time_at_address)}</BorrowerResidencyDurationMonthsCount>
                          <BorrowerResidencyType>${lead.current_housing === 'Renting' ? 'Rent' : 'Own'}</BorrowerResidencyType>
                        </RESIDENCE_DETAIL>
                      </RESIDENCE>
                    </RESIDENCES>
                    <CURRENT_INCOME>
                      <CURRENT_INCOME_ITEMS>
                        <CURRENT_INCOME_ITEM>
                          <CURRENT_INCOME_ITEM_DETAIL>
                            <CurrentIncomeMonthlyTotalAmount>${lead.monthly_income || Math.round((lead.gross_annual_income || 0) / 12)}</CurrentIncomeMonthlyTotalAmount>
                            <IncomeType>Base</IncomeType>
                          </CURRENT_INCOME_ITEM_DETAIL>
                        </CURRENT_INCOME_ITEM>${lead.other_income_amount ? `
                        <CURRENT_INCOME_ITEM>
                          <CURRENT_INCOME_ITEM_DETAIL>
                            <CurrentIncomeMonthlyTotalAmount>${lead.other_income_amount}</CurrentIncomeMonthlyTotalAmount>
                            <IncomeType>Other</IncomeType>
                            <IncomeTypeOtherDescription>${escapeXml(lead.other_income_source || 'Other Income')}</IncomeTypeOtherDescription>
                          </CURRENT_INCOME_ITEM_DETAIL>
                        </CURRENT_INCOME_ITEM>` : ''}
                      </CURRENT_INCOME_ITEMS>
                    </CURRENT_INCOME>
                    <EMPLOYERS>
                      <EMPLOYER>
                        <LEGAL_ENTITY>
                          <LEGAL_ENTITY_DETAIL>
                            <FullName>${escapeXml(lead.employer_name || '')}</FullName>
                          </LEGAL_ENTITY_DETAIL>
                          <CONTACTS>
                            <CONTACT>
                              <CONTACT_POINTS>
                                <CONTACT_POINT>
                                  <CONTACT_POINT_DETAIL>
                                    <ContactPointRoleType>Work</ContactPointRoleType>
                                  </CONTACT_POINT_DETAIL>
                                </CONTACT_POINT>
                              </CONTACT_POINTS>
                            </CONTACT>
                          </CONTACTS>
                        </LEGAL_ENTITY>
                        <ADDRESS>
                          <AddressLineText>${escapeXml(lead.employer_address || '')}</AddressLineText>
                        </ADDRESS>
                        <EMPLOYMENT>
                          <EmploymentStatusType>${mapEmploymentType(lead.employment_type)}</EmploymentStatusType>
                          <EmploymentPositionDescription>${escapeXml(lead.job_title || '')}</EmploymentPositionDescription>
                          <EmploymentMonthsOnJobCount>${getEmploymentMonths(lead.years_at_job)}</EmploymentMonthsOnJobCount>
                        </EMPLOYMENT>
                      </EMPLOYER>${previousEmployerSection}
                    </EMPLOYERS>
                    <HOUSING_EXPENSES>
                      <HOUSING_EXPENSE>
                        <HousingExpensePaymentAmount>${lead.current_housing_payment || 0}</HousingExpensePaymentAmount>
                        <HousingExpenseType>${lead.current_housing === 'Renting' ? 'Rent' : 'FirstMortgagePrincipalAndInterest'}</HousingExpenseType>
                      </HOUSING_EXPENSE>
                    </HOUSING_EXPENSES>
                  </BORROWER>
                  <ROLE_DETAIL>
                    <PartyRoleType>Borrower</PartyRoleType>
                  </ROLE_DETAIL>
                </ROLE>
              </ROLES>
            </PARTY>${coborrowerSection}
          </PARTIES>
${assetsSection}
${liabilitiesSection}
${subjectPropertySection}
        </DEAL>
      </DEALS>
    </DEAL_SET>
  </DEAL_SETS>
</MESSAGE>`;
}

module.exports = router;
