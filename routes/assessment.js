const express = require('express');
const router = express.Router();
const { getDatabase } = require('../services/database');
const { processLead } = require('../services/calculator');

// Start a new assessment (no agent)
router.get('/start', (req, res) => {
    const db = getDatabase();

    // Create a new lead with minimal data
    const result = db.prepare(`
        INSERT INTO leads (first_name, last_name, email, state)
        VALUES (?, ?, ?, ?)
    `).run('New', 'Lead', 'pending@temp.com', 'Utah');

    console.log('Created new lead with ID:', result.lastInsertRowid);

    // Redirect to the assessment form
    res.redirect(`/assessment/${result.lastInsertRowid}`);
});

// Assessment questions flow
router.get('/:leadId', (req, res) => {
    const db = getDatabase();
    const lead = db.prepare('SELECT * FROM leads WHERE id = ?').get(req.params.leadId);

    if (!lead) {
        return res.status(404).render('error', {
            title: 'Assessment Not Found',
            message: 'This assessment does not exist.'
        });
    }

    // Get agent if associated
    let agent = null;
    if (lead.agent_id) {
        agent = db.prepare('SELECT * FROM agents WHERE id = ?').get(lead.agent_id);
    }

    res.render('assessment/questions', {
        title: 'Home Readiness Assessment',
        lead,
        agent
    });
});

// Submit assessment
router.post('/:leadId/submit', (req, res) => {
    const db = getDatabase();
    const lead = db.prepare('SELECT * FROM leads WHERE id = ?').get(req.params.leadId);

    if (!lead) {
        return res.status(404).json({ error: 'Assessment not found' });
    }

    const data = req.body;

    // Parse currency values
    const grossAnnualIncome = parseInt(String(data.gross_annual_income).replace(/[^0-9]/g, '')) || 0;
    const coborrowerIncome = data.coborrower_gross_annual_income
        ? parseInt(String(data.coborrower_gross_annual_income).replace(/[^0-9]/g, '')) || 0
        : null;
    const downPaymentSaved = parseInt(String(data.down_payment_saved).replace(/[^0-9]/g, '')) || 0;

    // Parse arrays
    const downPaymentSources = Array.isArray(data.down_payment_sources)
        ? data.down_payment_sources
        : data.down_payment_sources ? [data.down_payment_sources] : [];

    const targetCounties = Array.isArray(data.target_counties)
        ? data.target_counties
        : data.target_counties ? [data.target_counties] : [];

    // Determine co-borrower status
    const hasCoborrower = data.coborrower_status && data.coborrower_status !== 'No, buying solo';

    // Update lead with form data
    db.prepare(`
        UPDATE leads SET
            first_name = ?,
            last_name = ?,
            email = ?,
            phone = ?,
            street_address = ?,
            city = ?,
            state = ?,
            zip = ?,
            time_at_address = ?,
            has_coborrower = ?,
            coborrower_first_name = ?,
            coborrower_last_name = ?,
            coborrower_email = ?,
            gross_annual_income = ?,
            coborrower_gross_annual_income = ?,
            employment_type = ?,
            coborrower_employment_type = ?,
            monthly_debt_payments = ?,
            credit_score_range = ?,
            coborrower_credit_score_range = ?,
            down_payment_saved = ?,
            down_payment_sources = ?,
            timeline = ?,
            target_counties = ?,
            first_time_buyer = ?,
            va_eligible = ?,
            current_housing = ?,
            updated_at = CURRENT_TIMESTAMP
        WHERE id = ?
    `).run(
        data.first_name,
        data.last_name,
        data.email,
        data.phone,
        data.street_address,
        data.city,
        data.state || 'Utah',
        data.zip,
        data.time_at_address,
        hasCoborrower ? 1 : 0,
        hasCoborrower ? data.coborrower_first_name : null,
        hasCoborrower ? data.coborrower_last_name : null,
        hasCoborrower ? data.coborrower_email : null,
        grossAnnualIncome,
        coborrowerIncome,
        data.employment_type,
        hasCoborrower ? data.coborrower_employment_type : null,
        data.monthly_debt_payments,
        data.credit_score_range,
        hasCoborrower ? data.coborrower_credit_score_range : null,
        downPaymentSaved,
        JSON.stringify(downPaymentSources),
        data.timeline,
        JSON.stringify(targetCounties),
        data.first_time_buyer,
        data.va_eligible,
        data.current_housing,
        req.params.leadId
    );

    // Get updated lead and calculate results
    const updatedLead = db.prepare('SELECT * FROM leads WHERE id = ?').get(req.params.leadId);
    const results = processLead(updatedLead);

    // Save calculated results
    db.prepare(`
        UPDATE leads SET
            readiness_score = ?,
            readiness_level = ?,
            red_light_reason = ?,
            comfortable_price = ?,
            stretch_price = ?,
            strained_price = ?,
            comfortable_loan = ?,
            stretch_loan = ?,
            strained_loan = ?,
            comfortable_payment = ?,
            stretch_payment = ?,
            strained_payment = ?
        WHERE id = ?
    `).run(
        results.readiness_score,
        results.readiness_level,
        results.red_light_reason,
        results.comfortable_price,
        results.stretch_price,
        results.strained_price,
        results.comfortable_loan,
        results.stretch_loan,
        results.strained_loan,
        results.comfortable_payment,
        results.stretch_payment,
        results.strained_payment,
        req.params.leadId
    );

    // Redirect to results page (AI generation will happen there)
    res.redirect(`/results/${req.params.leadId}`);
});

// Auto-save progress (AJAX endpoint)
router.post('/:leadId/save', (req, res) => {
    const db = getDatabase();
    const lead = db.prepare('SELECT * FROM leads WHERE id = ?').get(req.params.leadId);

    if (!lead) {
        return res.status(404).json({ error: 'Assessment not found' });
    }

    // Save partial data
    const data = req.body;
    const updates = [];
    const values = [];

    // Build dynamic update query for non-empty fields
    Object.keys(data).forEach(key => {
        if (data[key] !== undefined && data[key] !== '') {
            updates.push(`${key} = ?`);
            values.push(data[key]);
        }
    });

    if (updates.length > 0) {
        updates.push('updated_at = CURRENT_TIMESTAMP');
        values.push(req.params.leadId);

        db.prepare(`
            UPDATE leads SET ${updates.join(', ')} WHERE id = ?
        `).run(...values);
    }

    res.json({ success: true });
});

module.exports = router;
