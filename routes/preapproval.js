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

// Submit pre-approval documents
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

    const drive = initDriveClient();
    if (!drive) {
        console.error('Google Drive not configured - documents not uploaded');
        return res.redirect(`/preapproval/${req.params.leadId}/status?error=upload`);
    }

    try {
        // Get or create lead folder
        const folderId = await getLeadFolderId(drive, lead);
        if (!folderId) {
            throw new Error('Could not get/create lead folder');
        }

        // Upload each document type
        const uploadedDocs = [];

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

        console.log(`Uploaded ${uploadedDocs.length} documents for lead ${lead.id}`);
        res.redirect(`/preapproval/${req.params.leadId}/status?success=true&count=${uploadedDocs.length}`);

    } catch (err) {
        console.error('Error uploading documents:', err.message);
        res.redirect(`/preapproval/${req.params.leadId}/status?error=upload`);
    }
});

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
