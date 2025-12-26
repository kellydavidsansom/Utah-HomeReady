/**
 * Google Drive Service
 * Uploads lead reports to Google Drive shared folder
 */

const { google } = require('googleapis');
const stream = require('stream');

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
        console.log('Google Drive: No service account key configured');
        return null;
    }

    try {
        const keyFile = JSON.parse(credentials);
        const auth = new google.auth.GoogleAuth({
            credentials: keyFile,
            scopes: ['https://www.googleapis.com/auth/drive.file']
        });

        driveClient = google.drive({ version: 'v3', auth });
        console.log('Google Drive client initialized');
        return driveClient;
    } catch (err) {
        console.error('Failed to initialize Google Drive:', err.message);
        return null;
    }
}

/**
 * Upload a PDF report to Google Drive
 * @param {Buffer} pdfBuffer - The PDF file as a buffer
 * @param {Object} lead - Lead data for naming the file
 * @returns {Object|null} - File metadata or null on failure
 */
async function uploadReport(pdfBuffer, lead) {
    const drive = initDriveClient();
    if (!drive) {
        console.log('Google Drive upload skipped - no client configured');
        return null;
    }

    try {
        // Create filename: LastName_FirstName_Date.pdf
        const date = new Date().toISOString().split('T')[0];
        const lastName = (lead.last_name || 'Unknown').replace(/[^a-zA-Z]/g, '');
        const firstName = (lead.first_name || 'Lead').replace(/[^a-zA-Z]/g, '');
        const fileName = `${lastName}_${firstName}_${date}.pdf`;

        // Convert buffer to readable stream
        const bufferStream = new stream.PassThrough();
        bufferStream.end(pdfBuffer);

        // Upload to Google Drive
        const fileMetadata = {
            name: fileName,
            parents: [FOLDER_ID]
        };

        const media = {
            mimeType: 'application/pdf',
            body: bufferStream
        };

        const response = await drive.files.create({
            requestBody: fileMetadata,
            media: media,
            fields: 'id, name, webViewLink',
            supportsAllDrives: true
        });

        console.log('Uploaded to Google Drive:', response.data.name, response.data.id);
        return response.data;
    } catch (err) {
        console.error('Google Drive upload failed:', err.message);
        return null;
    }
}

/**
 * Upload lead data as a JSON file (for backup/integration)
 * @param {Object} lead - Complete lead data
 * @returns {Object|null} - File metadata or null on failure
 */
async function uploadLeadData(lead) {
    const drive = initDriveClient();
    if (!drive) {
        return null;
    }

    try {
        const date = new Date().toISOString().split('T')[0];
        const lastName = (lead.last_name || 'Unknown').replace(/[^a-zA-Z]/g, '');
        const firstName = (lead.first_name || 'Lead').replace(/[^a-zA-Z]/g, '');
        const fileName = `${lastName}_${firstName}_${date}_data.json`;

        const bufferStream = new stream.PassThrough();
        bufferStream.end(JSON.stringify(lead, null, 2));

        const fileMetadata = {
            name: fileName,
            parents: [FOLDER_ID]
        };

        const media = {
            mimeType: 'application/json',
            body: bufferStream
        };

        const response = await drive.files.create({
            requestBody: fileMetadata,
            media: media,
            fields: 'id, name',
            supportsAllDrives: true
        });

        console.log('Uploaded lead data to Google Drive:', response.data.name);
        return response.data;
    } catch (err) {
        console.error('Google Drive lead data upload failed:', err.message);
        return null;
    }
}

module.exports = {
    initDriveClient,
    uploadReport,
    uploadLeadData
};
