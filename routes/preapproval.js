const express = require('express');
const router = express.Router();
const multer = require('multer');
const { getDatabase } = require('../services/database');
const { google } = require('googleapis');
const stream = require('stream');

// Configure multer for memory storage
const upload = multer({
    storage: multer.memoryStorage(),
    limits: { fileSize: 10 * 1024 * 1024 }, // 10MB limit
    fileFilter: (req, file, cb) => {
        const allowed = ['application/pdf', 'image/jpeg', 'image/png', 'image/jpg'];
        if (allowed.includes(file.mimetype)) {
            cb(null, true);
        } else {
            cb(new Error('Only PDF, JPG, and PNG files are allowed'));
        }
    }
});

// Google Drive folder ID
const FOLDER_ID = process.env.GOOGLE_DRIVE_FOLDER_ID || '0AHwXqknwZ_YOUk9PVA';

// Initialize Google Drive client
function initDriveClient() {
    const credentials = process.env.GOOGLE_SERVICE_ACCOUNT_KEY;
    if (!credentials) {
        console.log('Google Drive: No service account key configured');
        return null;
    }

    try {
        const keyFile = JSON.parse(credentials);
        const auth = new google.auth.GoogleAuth({
            credentials: keyFile,
            scopes: ['https://www.googleapis.com/auth/drive.file']
        });
        return google.drive({ version: 'v3', auth });
    } catch (err) {
        console.error('Failed to initialize Google Drive:', err.message);
        return null;
    }
}

// Find or create lead folder
async function getLeadFolderId(drive, lead) {
    try {
        const lastName = (lead.last_name || 'Unknown').trim();
        const firstName = (lead.first_name || 'Lead').trim();
        const folderName = `${lastName}, ${firstName}`;

        // Search for existing folder
        const searchResponse = await drive.files.list({
            q: `name='${folderName}' and '${FOLDER_ID}' in parents and mimeType='application/vnd.google-apps.folder' and trashed=false`,
            fields: 'files(id, name)',
            supportsAllDrives: true,
            includeItemsFromAllDrives: true
        });

        if (searchResponse.data.files && searchResponse.data.files.length > 0) {
            console.log('Found existing folder:', searchResponse.data.files[0].id);
            return searchResponse.data.files[0].id;
        }

        // Create new folder
        const fileMetadata = {
            name: folderName,
            mimeType: 'application/vnd.google-apps.folder',
            parents: [FOLDER_ID]
        };

        const createResponse = await drive.files.create({
            requestBody: fileMetadata,
            fields: 'id, name',
            supportsAllDrives: true
        });

        console.log('Created new folder:', createResponse.data.id);
        return createResponse.data.id;
    } catch (err) {
        console.error('Error getting/creating lead folder:', err.message);
        return null;
    }
}

// Upload file to Google Drive
async function uploadFileToDrive(drive, file, folderId, docType) {
    try {
        const bufferStream = new stream.PassThrough();
        bufferStream.end(file.buffer);

        // Clean filename
        const ext = file.originalname.split('.').pop();
        const fileName = `${docType}_${Date.now()}.${ext}`;

        const fileMetadata = {
            name: fileName,
            parents: [folderId]
        };

        const media = {
            mimeType: file.mimetype,
            body: bufferStream
        };

        const response = await drive.files.create({
            requestBody: fileMetadata,
            media: media,
            fields: 'id, name, webViewLink',
            supportsAllDrives: true
        });

        console.log('Uploaded document:', response.data.name);
        return response.data;
    } catch (err) {
        console.error('Error uploading file:', err.message);
        return null;
    }
}

// Pre-approval form
router.get('/:leadId', (req, res) => {
    const db = getDatabase();
    const lead = db.prepare('SELECT * FROM leads WHERE id = ?').get(req.params.leadId);

    if (!lead) {
        return res.status(404).render('error', {
            title: 'Not Found',
            message: 'Lead not found.'
        });
    }

    let agent = null;
    if (lead.agent_id) {
        agent = db.prepare('SELECT * FROM agents WHERE id = ?').get(lead.agent_id);
    }

    res.render('preapproval/form', {
        title: 'Get Pre-Approved',
        lead,
        agent
    });
});

// Helper to parse currency string to number
function parseCurrency(value) {
    if (!value) return null;
    // Remove $ and commas
    const cleaned = value.toString().replace(/[$,]/g, '');
    const num = parseFloat(cleaned);
    return isNaN(num) ? null : num;
}

// Submit pre-approval application with documents
router.post('/:leadId/submit', upload.fields([
    { name: 'tax_returns', maxCount: 5 },
    { name: 'pay_stubs', maxCount: 5 },
    { name: 'bank_statements', maxCount: 5 },
    { name: 'id', maxCount: 2 }
]), async (req, res) => {
    const db = getDatabase();
    const lead = db.prepare('SELECT * FROM leads WHERE id = ?').get(req.params.leadId);

    if (!lead) {
        return res.status(404).render('error', {
            title: 'Not Found',
            message: 'Lead not found.'
        });
    }

    try {
        // Save all the pre-approval form data
        db.prepare(`
            UPDATE leads SET
                date_of_birth = ?,
                citizenship_status = ?,
                employer_name = ?,
                employer_address = ?,
                job_title = ?,
                years_at_job = ?,
                previous_employer_name = ?,
                previous_employer_years = ?,
                monthly_income = ?,
                other_income_amount = ?,
                other_income_source = ?,
                current_housing_payment = ?,
                monthly_debt_amount = ?,
                checking_balance = ?,
                savings_balance = ?,
                retirement_balance = ?,
                other_assets_balance = ?,
                other_assets_description = ?,
                pays_alimony_child_support = ?,
                alimony_amount = ?,
                has_bankruptcy = ?,
                bankruptcy_details = ?,
                has_foreclosure = ?,
                foreclosure_details = ?,
                has_judgments_liens = ?,
                judgments_details = ?,
                property_type = ?,
                property_use = ?,
                has_property_in_mind = ?,
                property_address = ?,
                preapproval_submitted = 1,
                preapproval_submitted_at = CURRENT_TIMESTAMP,
                updated_at = CURRENT_TIMESTAMP
            WHERE id = ?
        `).run(
            req.body.date_of_birth || null,
            req.body.citizenship_status || null,
            req.body.employer_name || null,
            req.body.employer_address || null,
            req.body.job_title || null,
            req.body.years_at_job || null,
            req.body.previous_employer_name || null,
            req.body.previous_employer_years || null,
            parseCurrency(req.body.monthly_income),
            parseCurrency(req.body.other_income_amount),
            req.body.other_income_source || null,
            parseCurrency(req.body.current_housing_payment),
            parseCurrency(req.body.monthly_debt_amount),
            parseCurrency(req.body.checking_balance),
            parseCurrency(req.body.savings_balance),
            parseCurrency(req.body.retirement_balance),
            parseCurrency(req.body.other_assets_balance),
            req.body.other_assets_description || null,
            req.body.pays_alimony_child_support || null,
            parseCurrency(req.body.alimony_amount),
            req.body.has_bankruptcy || null,
            req.body.bankruptcy_details || null,
            req.body.has_foreclosure || null,
            req.body.foreclosure_details || null,
            req.body.has_judgments_liens || null,
            req.body.judgments_details || null,
            req.body.property_type || null,
            req.body.property_use || null,
            req.body.has_property_in_mind || null,
            req.body.property_address || null,
            lead.id
        );

        console.log(`Saved pre-approval data for lead ${lead.id}`);

        // Handle document uploads to Google Drive
        const drive = initDriveClient();
        let uploadedDocs = [];
        let folderId = lead.google_drive_folder_id;

        if (drive) {
            // Get or create lead folder
            folderId = await getLeadFolderId(drive, lead);
            if (folderId) {
                // Upload each document type
                if (req.files['tax_returns']) {
                    for (const file of req.files['tax_returns']) {
                        const result = await uploadFileToDrive(drive, file, folderId, 'Tax_Return');
                        if (result) uploadedDocs.push({ type: 'tax_returns', ...result });
                    }
                }

                if (req.files['pay_stubs']) {
                    for (const file of req.files['pay_stubs']) {
                        const result = await uploadFileToDrive(drive, file, folderId, 'Pay_Stub');
                        if (result) uploadedDocs.push({ type: 'pay_stubs', ...result });
                    }
                }

                if (req.files['bank_statements']) {
                    for (const file of req.files['bank_statements']) {
                        const result = await uploadFileToDrive(drive, file, folderId, 'Bank_Statement');
                        if (result) uploadedDocs.push({ type: 'bank_statements', ...result });
                    }
                }

                if (req.files['id']) {
                    for (const file of req.files['id']) {
                        const result = await uploadFileToDrive(drive, file, folderId, 'Photo_ID');
                        if (result) uploadedDocs.push({ type: 'id', ...result });
                    }
                }

                // Save document info to database
                for (const doc of uploadedDocs) {
                    db.prepare(`
                        INSERT INTO documents (lead_id, document_type, file_name, google_drive_file_id, google_drive_url)
                        VALUES (?, ?, ?, ?, ?)
                    `).run(lead.id, doc.type, doc.name, doc.id, doc.webViewLink || '');
                }

                // Update lead folder ID
                db.prepare('UPDATE leads SET google_drive_folder_id = ? WHERE id = ?').run(folderId, lead.id);

                // Generate and upload Pre-Approval Application PDF
                await uploadPreApprovalPDF(drive, lead.id, folderId);
            }
        } else {
            console.log('Google Drive not configured - documents saved locally only');
        }

        console.log(`Uploaded ${uploadedDocs.length} documents for lead ${lead.id}`);
        res.redirect(`/preapproval/${req.params.leadId}/status?success=true&count=${uploadedDocs.length}`);

    } catch (err) {
        console.error('Error processing pre-approval:', err.message);
        res.redirect(`/preapproval/${req.params.leadId}/status?error=upload`);
    }
});

// Generate and upload Pre-Approval Application PDF
async function uploadPreApprovalPDF(drive, leadId, folderId) {
    const PDFDocument = require('pdfkit');
    const db = getDatabase();
    const lead = db.prepare('SELECT * FROM leads WHERE id = ?').get(leadId);

    if (!lead) return null;

    try {
        const pdfBuffer = await new Promise((resolve, reject) => {
            const chunks = [];
            const doc = new PDFDocument({ margin: 50 });

            doc.on('data', chunk => chunks.push(chunk));
            doc.on('end', () => resolve(Buffer.concat(chunks)));
            doc.on('error', reject);

            // Header
            doc.fontSize(20).text('Pre-Approval Application', { align: 'center' });
            doc.fontSize(10).text(`Submitted: ${new Date().toLocaleString()}`, { align: 'center' });
            doc.moveDown(2);

            // Contact Information
            doc.fontSize(14).fillColor('#2563eb').text('Contact Information', { underline: true });
            doc.fillColor('black').fontSize(11);
            doc.moveDown(0.5);
            addPdfField(doc, 'Name', `${lead.first_name} ${lead.last_name}`);
            addPdfField(doc, 'Email', lead.email);
            addPdfField(doc, 'Phone', lead.phone);
            addPdfField(doc, 'Date of Birth', lead.date_of_birth);
            addPdfField(doc, 'Citizenship', lead.citizenship_status);
            doc.moveDown();

            // Current Address
            doc.fontSize(14).fillColor('#2563eb').text('Current Address', { underline: true });
            doc.fillColor('black').fontSize(11);
            doc.moveDown(0.5);
            addPdfField(doc, 'Street', lead.street_address);
            addPdfField(doc, 'City', lead.city);
            addPdfField(doc, 'State', lead.state);
            addPdfField(doc, 'Zip', lead.zip);
            addPdfField(doc, 'Time at Address', lead.time_at_address);
            doc.moveDown();

            // Employment Information
            doc.fontSize(14).fillColor('#2563eb').text('Employment Information', { underline: true });
            doc.fillColor('black').fontSize(11);
            doc.moveDown(0.5);
            addPdfField(doc, 'Employment Type', lead.employment_type);
            addPdfField(doc, 'Employer', lead.employer_name);
            addPdfField(doc, 'Employer Address', lead.employer_address);
            addPdfField(doc, 'Job Title', lead.job_title);
            addPdfField(doc, 'Years at Job', lead.years_at_job);
            if (lead.previous_employer_name) {
                addPdfField(doc, 'Previous Employer', lead.previous_employer_name);
                addPdfField(doc, 'Previous Employer Years', lead.previous_employer_years);
            }
            doc.moveDown();

            // Financial Information
            doc.fontSize(14).fillColor('#2563eb').text('Financial Information', { underline: true });
            doc.fillColor('black').fontSize(11);
            doc.moveDown(0.5);
            addPdfField(doc, 'Monthly Income', formatPdfCurrency(lead.monthly_income));
            addPdfField(doc, 'Other Income', formatPdfCurrency(lead.other_income_amount));
            if (lead.other_income_source) {
                addPdfField(doc, 'Other Income Source', lead.other_income_source);
            }
            addPdfField(doc, 'Current Housing Payment', formatPdfCurrency(lead.current_housing_payment));
            addPdfField(doc, 'Monthly Debt Payments', formatPdfCurrency(lead.monthly_debt_amount));
            addPdfField(doc, 'Credit Score Range', lead.credit_score_range);
            doc.moveDown();

            // Assets
            doc.fontSize(14).fillColor('#2563eb').text('Assets', { underline: true });
            doc.fillColor('black').fontSize(11);
            doc.moveDown(0.5);
            addPdfField(doc, 'Down Payment Saved', formatPdfCurrency(lead.down_payment_saved));
            addPdfField(doc, 'Checking Balance', formatPdfCurrency(lead.checking_balance));
            addPdfField(doc, 'Savings Balance', formatPdfCurrency(lead.savings_balance));
            addPdfField(doc, 'Retirement Balance', formatPdfCurrency(lead.retirement_balance));
            addPdfField(doc, 'Other Assets', formatPdfCurrency(lead.other_assets_balance));
            if (lead.other_assets_description) {
                addPdfField(doc, 'Other Assets Description', lead.other_assets_description);
            }
            doc.moveDown();

            // Liabilities & History
            doc.fontSize(14).fillColor('#2563eb').text('Liabilities & History', { underline: true });
            doc.fillColor('black').fontSize(11);
            doc.moveDown(0.5);
            addPdfField(doc, 'Pays Alimony/Child Support', lead.pays_alimony_child_support);
            if (lead.alimony_amount) {
                addPdfField(doc, 'Alimony/Support Amount', formatPdfCurrency(lead.alimony_amount));
            }
            addPdfField(doc, 'Bankruptcy in Last 7 Years', lead.has_bankruptcy);
            if (lead.bankruptcy_details) {
                addPdfField(doc, 'Bankruptcy Details', lead.bankruptcy_details);
            }
            addPdfField(doc, 'Foreclosure in Last 7 Years', lead.has_foreclosure);
            if (lead.foreclosure_details) {
                addPdfField(doc, 'Foreclosure Details', lead.foreclosure_details);
            }
            addPdfField(doc, 'Outstanding Judgments/Liens', lead.has_judgments_liens);
            if (lead.judgments_details) {
                addPdfField(doc, 'Judgments Details', lead.judgments_details);
            }
            doc.moveDown();

            // Property Intent
            doc.fontSize(14).fillColor('#2563eb').text('Property Intent', { underline: true });
            doc.fillColor('black').fontSize(11);
            doc.moveDown(0.5);
            addPdfField(doc, 'Property Type', lead.property_type);
            addPdfField(doc, 'Property Use', lead.property_use);
            addPdfField(doc, 'Has Property in Mind', lead.has_property_in_mind);
            if (lead.property_address) {
                addPdfField(doc, 'Property Address', lead.property_address);
            }
            doc.moveDown();

            // Co-Borrower Information
            if (lead.has_coborrower) {
                doc.fontSize(14).fillColor('#2563eb').text('Co-Borrower Information', { underline: true });
                doc.fillColor('black').fontSize(11);
                doc.moveDown(0.5);
                addPdfField(doc, 'Name', `${lead.coborrower_first_name} ${lead.coborrower_last_name}`);
                addPdfField(doc, 'Email', lead.coborrower_email);
                addPdfField(doc, 'Income', formatPdfCurrency(lead.coborrower_gross_annual_income));
                addPdfField(doc, 'Employment', lead.coborrower_employment_type);
                addPdfField(doc, 'Credit Score', lead.coborrower_credit_score_range);
                doc.moveDown();
            }

            // Assessment Results
            doc.fontSize(14).fillColor('#2563eb').text('Assessment Results', { underline: true });
            doc.fillColor('black').fontSize(11);
            doc.moveDown(0.5);
            addPdfField(doc, 'Readiness Score', `${lead.readiness_score}/100`);
            addPdfField(doc, 'Readiness Level', lead.readiness_level ? lead.readiness_level.toUpperCase() : 'N/A');
            addPdfField(doc, 'Timeline', lead.timeline);
            addPdfField(doc, 'First-Time Buyer', lead.first_time_buyer);
            addPdfField(doc, 'VA Eligible', lead.va_eligible);

            doc.end();
        });

        // Upload to Google Drive
        const bufferStream = new stream.PassThrough();
        bufferStream.end(pdfBuffer);

        const response = await drive.files.create({
            requestBody: {
                name: 'Pre-Approval Application.pdf',
                parents: [folderId]
            },
            media: {
                mimeType: 'application/pdf',
                body: bufferStream
            },
            fields: 'id, name',
            supportsAllDrives: true
        });

        console.log('Uploaded Pre-Approval Application PDF:', response.data.name);
        return response.data;
    } catch (err) {
        console.error('Error generating pre-approval PDF:', err.message);
        return null;
    }
}

function addPdfField(doc, label, value) {
    doc.font('Helvetica-Bold').text(`${label}: `, { continued: true });
    doc.font('Helvetica').text(value || 'N/A');
}

function formatPdfCurrency(value) {
    if (!value) return 'N/A';
    return '$' + Number(value).toLocaleString();
}

// Check status
router.get('/:leadId/status', (req, res) => {
    const db = getDatabase();
    const lead = db.prepare('SELECT * FROM leads WHERE id = ?').get(req.params.leadId);

    if (!lead) {
        return res.status(404).render('error', {
            title: 'Not Found',
            message: 'Lead not found.'
        });
    }

    let agent = null;
    if (lead.agent_id) {
        agent = db.prepare('SELECT * FROM agents WHERE id = ?').get(lead.agent_id);
    }

    // Get uploaded documents
    const documents = db.prepare('SELECT * FROM documents WHERE lead_id = ?').all(lead.id);

    res.render('preapproval/status', {
        title: 'Pre-Approval Status',
        lead,
        agent,
        documents,
        success: req.query.success === 'true',
        uploadCount: req.query.count || 0,
        error: req.query.error
    });
});

module.exports = router;
