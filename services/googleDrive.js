/**
 * Google Drive Service
 * Uploads lead reports to Google Drive in organized folders
 */

const { google } = require('googleapis');
const stream = require('stream');
const PDFDocument = require('pdfkit');

// Shared Drive folder ID
const FOLDER_ID = process.env.GOOGLE_DRIVE_FOLDER_ID || '0AHwXqknwZ_YOUk9PVA';

let driveClient = null;

/**
 * Initialize Google Drive client with service account
 */
function initDriveClient() {
    if (driveClient) return driveClient;

    const credentials = process.env.GOOGLE_SERVICE_ACCOUNT_KEY;
    if (!credentials) {
        console.log('Google Drive: No GOOGLE_SERVICE_ACCOUNT_KEY environment variable found');
        return null;
    }

    try {
        const keyFile = JSON.parse(credentials);
        console.log('Google Drive: Service account email:', keyFile.client_email);
        console.log('Google Drive: Target folder ID:', FOLDER_ID);

        const auth = new google.auth.GoogleAuth({
            credentials: keyFile,
            scopes: ['https://www.googleapis.com/auth/drive.file']
        });

        driveClient = google.drive({ version: 'v3', auth });
        console.log('Google Drive client initialized successfully');
        return driveClient;
    } catch (err) {
        console.error('Failed to initialize Google Drive:', err.message);
        return null;
    }
}

/**
 * Create a folder for the lead
 */
async function createLeadFolder(lead) {
    const drive = initDriveClient();
    if (!drive) return null;

    try {
        const lastName = (lead.last_name || 'Unknown').trim();
        const firstName = (lead.first_name || 'Lead').trim();
        const folderName = `${lastName}, ${firstName}`;

        const fileMetadata = {
            name: folderName,
            mimeType: 'application/vnd.google-apps.folder',
            parents: [FOLDER_ID]
        };

        const response = await drive.files.create({
            requestBody: fileMetadata,
            fields: 'id, name',
            supportsAllDrives: true
        });

        console.log('Google Drive: Created folder:', response.data.name, response.data.id);
        return response.data.id;
    } catch (err) {
        console.error('Google Drive folder creation failed:', err.message);
        return null;
    }
}

/**
 * Upload a PDF report to Google Drive
 */
async function uploadReport(pdfBuffer, lead, folderId) {
    const drive = initDriveClient();
    if (!drive) {
        console.log('Google Drive upload skipped - no client configured');
        return null;
    }

    try {
        const targetFolder = folderId || FOLDER_ID;
        const fileName = 'Home Readiness Report.pdf';

        const bufferStream = new stream.PassThrough();
        bufferStream.end(pdfBuffer);

        const fileMetadata = {
            name: fileName,
            parents: [targetFolder]
        };

        const media = {
            mimeType: 'application/pdf',
            body: bufferStream
        };

        console.log('Google Drive: Uploading report to folder:', targetFolder);

        const response = await drive.files.create({
            requestBody: fileMetadata,
            media: media,
            fields: 'id, name, webViewLink',
            supportsAllDrives: true
        });

        console.log('Google Drive: Report uploaded!', response.data.name);
        return response.data;
    } catch (err) {
        console.error('Google Drive report upload failed:', err.message);
        return null;
    }
}

/**
 * Generate and upload a formatted PDF with all lead data
 */
async function uploadLeadDetailsPDF(lead, folderId) {
    const drive = initDriveClient();
    if (!drive) return null;

    try {
        const targetFolder = folderId || FOLDER_ID;
        const fileName = 'Lead Details.pdf';

        // Generate PDF with lead details
        const pdfBuffer = await generateLeadDetailsPDF(lead);

        const bufferStream = new stream.PassThrough();
        bufferStream.end(pdfBuffer);

        const fileMetadata = {
            name: fileName,
            parents: [targetFolder]
        };

        const media = {
            mimeType: 'application/pdf',
            body: bufferStream
        };

        const response = await drive.files.create({
            requestBody: fileMetadata,
            media: media,
            fields: 'id, name',
            supportsAllDrives: true
        });

        console.log('Google Drive: Lead details PDF uploaded!', response.data.name);
        return response.data;
    } catch (err) {
        console.error('Google Drive lead details upload failed:', err.message);
        return null;
    }
}

/**
 * Generate a nicely formatted PDF with all lead information
 */
function generateLeadDetailsPDF(lead) {
    return new Promise((resolve, reject) => {
        const chunks = [];
        const doc = new PDFDocument({ margin: 50 });

        doc.on('data', chunk => chunks.push(chunk));
        doc.on('end', () => resolve(Buffer.concat(chunks)));
        doc.on('error', reject);

        // Header
        doc.fontSize(20).text('Lead Information', { align: 'center' });
        doc.fontSize(10).text(`Generated: ${new Date().toLocaleString()}`, { align: 'center' });
        doc.moveDown(2);

        // Contact Information
        doc.fontSize(14).fillColor('#2563eb').text('Contact Information', { underline: true });
        doc.fillColor('black').fontSize(11);
        doc.moveDown(0.5);
        addField(doc, 'Name', `${lead.first_name} ${lead.last_name}`);
        addField(doc, 'Email', lead.email);
        addField(doc, 'Phone', lead.phone);
        doc.moveDown();

        // Current Address
        doc.fontSize(14).fillColor('#2563eb').text('Current Address', { underline: true });
        doc.fillColor('black').fontSize(11);
        doc.moveDown(0.5);
        addField(doc, 'Street', lead.street_address);
        addField(doc, 'City', lead.city);
        addField(doc, 'State', lead.state);
        addField(doc, 'Zip', lead.zip);
        addField(doc, 'Time at Address', lead.time_at_address);
        doc.moveDown();

        // Co-Borrower Information
        if (lead.has_coborrower) {
            doc.fontSize(14).fillColor('#2563eb').text('Co-Borrower Information', { underline: true });
            doc.fillColor('black').fontSize(11);
            doc.moveDown(0.5);
            addField(doc, 'Name', `${lead.coborrower_first_name} ${lead.coborrower_last_name}`);
            addField(doc, 'Email', lead.coborrower_email);
            addField(doc, 'Income', formatCurrency(lead.coborrower_gross_annual_income));
            addField(doc, 'Employment', lead.coborrower_employment_type);
            addField(doc, 'Credit Score', lead.coborrower_credit_score_range);
            doc.moveDown();
        }

        // Financial Information
        doc.fontSize(14).fillColor('#2563eb').text('Financial Information', { underline: true });
        doc.fillColor('black').fontSize(11);
        doc.moveDown(0.5);
        addField(doc, 'Gross Annual Income', formatCurrency(lead.gross_annual_income));
        addField(doc, 'Employment Type', lead.employment_type);
        addField(doc, 'Monthly Debt Payments', lead.monthly_debt_payments);
        addField(doc, 'Credit Score Range', lead.credit_score_range);
        addField(doc, 'Down Payment Saved', formatCurrency(lead.down_payment_saved));

        // Parse down payment sources
        let sources = [];
        try { sources = JSON.parse(lead.down_payment_sources || '[]'); } catch (e) {}
        if (sources.length > 0) {
            addField(doc, 'Down Payment Sources', sources.join(', '));
        }
        doc.moveDown();

        // Home Buying Plans
        doc.fontSize(14).fillColor('#2563eb').text('Home Buying Plans', { underline: true });
        doc.fillColor('black').fontSize(11);
        doc.moveDown(0.5);
        addField(doc, 'Timeline', lead.timeline);

        // Parse target counties
        let counties = [];
        try { counties = JSON.parse(lead.target_counties || '[]'); } catch (e) {}
        if (counties.length > 0) {
            addField(doc, 'Target Counties', counties.join(', '));
        }

        addField(doc, 'First-Time Buyer', lead.first_time_buyer);
        addField(doc, 'VA Eligible', lead.va_eligible);
        addField(doc, 'Current Housing', lead.current_housing);
        doc.moveDown();

        // Results Summary
        doc.fontSize(14).fillColor('#2563eb').text('Assessment Results', { underline: true });
        doc.fillColor('black').fontSize(11);
        doc.moveDown(0.5);
        addField(doc, 'Readiness Score', `${lead.readiness_score}/100`);
        addField(doc, 'Readiness Level', lead.readiness_level ? lead.readiness_level.toUpperCase() : 'N/A');
        if (lead.red_light_reason) {
            addField(doc, 'Red Light Reason', lead.red_light_reason);
        }
        doc.moveDown();

        // Affordability
        doc.fontSize(14).fillColor('#2563eb').text('Affordability Analysis', { underline: true });
        doc.fillColor('black').fontSize(11);
        doc.moveDown(0.5);
        addField(doc, 'Comfortable Price', formatCurrency(lead.comfortable_price));
        addField(doc, 'Comfortable Payment', `${formatCurrency(lead.comfortable_payment)}/mo`);
        addField(doc, 'Stretch Price', formatCurrency(lead.stretch_price));
        addField(doc, 'Stretch Payment', `${formatCurrency(lead.stretch_payment)}/mo`);
        addField(doc, 'Strained Price', formatCurrency(lead.strained_price));
        addField(doc, 'Strained Payment', `${formatCurrency(lead.strained_payment)}/mo`);

        doc.end();
    });
}

function addField(doc, label, value) {
    doc.font('Helvetica-Bold').text(`${label}: `, { continued: true });
    doc.font('Helvetica').text(value || 'N/A');
}

function formatCurrency(value) {
    if (!value) return 'N/A';
    return '$' + Number(value).toLocaleString();
}

/**
 * Main function to upload all lead files to Drive
 */
async function uploadLeadToDrive(pdfBuffer, lead) {
    const drive = initDriveClient();
    if (!drive) {
        console.log('Google Drive upload skipped - no client configured');
        return null;
    }

    try {
        // Create folder for this lead
        const folderId = await createLeadFolder(lead);
        if (!folderId) {
            console.error('Failed to create lead folder, uploading to root');
        }

        // Upload the readiness report PDF
        await uploadReport(pdfBuffer, lead, folderId);

        // Upload the detailed lead info PDF
        await uploadLeadDetailsPDF(lead, folderId);

        console.log('Google Drive: All files uploaded for', lead.first_name, lead.last_name);
        return { folderId };
    } catch (err) {
        console.error('Google Drive upload failed:', err.message);
        return null;
    }
}

module.exports = {
    initDriveClient,
    uploadLeadToDrive,
    createLeadFolder,
    uploadReport,
    uploadLeadDetailsPDF
};
