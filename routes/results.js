const express = require('express');
const router = express.Router();
const { getDatabase } = require('../services/database');
const { generateAISummary, generateActionItems } = require('../services/claude');
const { sendToHighLevel } = require('../services/highlevel');
const Mailgun = require('mailgun.js');
const formData = require('form-data');
const PDFDocument = require('pdfkit');

// View results
router.get('/:leadId', async (req, res) => {
    const db = getDatabase();
    const lead = db.prepare('SELECT * FROM leads WHERE id = ?').get(req.params.leadId);

    if (!lead) {
        return res.status(404).render('error', {
            title: 'Results Not Found',
            message: 'These results do not exist.'
        });
    }

    // Get agent if associated
    let agent = null;
    if (lead.agent_id) {
        agent = db.prepare('SELECT * FROM agents WHERE id = ?').get(lead.agent_id);
    }

    // Generate AI content if not already generated
    if (!lead.ai_summary) {
        try {
            console.log('Generating AI summary for lead:', lead.id);
            const aiSummary = await generateAISummary(lead, agent);
            const actionItems = await generateActionItems(lead);

            // Save to database
            db.prepare(`
                UPDATE leads SET
                    ai_summary = ?,
                    action_items = ?
                WHERE id = ?
            `).run(aiSummary, JSON.stringify(actionItems), lead.id);

            lead.ai_summary = aiSummary;
            lead.action_items = JSON.stringify(actionItems);

            // Send to HighLevel CRM
            sendToHighLevel(lead, agent).catch(err => {
                console.error('HighLevel sync error:', err.message);
            });

            // TODO: Send emails to lead, agent, and Kelly

        } catch (error) {
            console.error('Error generating AI content:', error);
        }
    }

    // Parse action items
    let actionItems = [];
    try {
        actionItems = JSON.parse(lead.action_items || '[]');
    } catch (e) {
        console.error('Error parsing action items:', e);
    }

    // Parse other JSON fields
    let targetCounties = [];
    let downPaymentSources = [];
    try {
        targetCounties = JSON.parse(lead.target_counties || '[]');
        downPaymentSources = JSON.parse(lead.down_payment_sources || '[]');
    } catch (e) {}

    res.render('results/show', {
        title: 'Your Home Readiness Results',
        lead,
        agent,
        actionItems,
        targetCounties,
        downPaymentSources,
        emailed: req.query.emailed === 'true',
        error: req.query.error
    });
});

// Download PDF report
router.get('/:leadId/pdf', async (req, res) => {
    const db = getDatabase();
    const lead = db.prepare('SELECT * FROM leads WHERE id = ?').get(req.params.leadId);

    if (!lead) {
        return res.status(404).json({ error: 'Lead not found' });
    }

    // Get agent
    let agent = null;
    if (lead.agent_id) {
        agent = db.prepare('SELECT * FROM agents WHERE id = ?').get(lead.agent_id);
    }

    try {
        const PDFDocument = require('pdfkit');
        const doc = new PDFDocument({ margin: 50 });

        res.setHeader('Content-Type', 'application/pdf');
        res.setHeader('Content-Disposition', `attachment; filename="home-readiness-report-${lead.id}.pdf"`);

        doc.pipe(res);

        // Header
        doc.fontSize(24).text('Utah Home Ready Check', { align: 'center' });
        doc.fontSize(14).text('Your Personalized Readiness Report', { align: 'center' });
        doc.moveDown();

        // Traffic light indicator
        const colors = { green: '#22c55e', yellow: '#eab308', red: '#ef4444' };
        const labels = { green: 'GREEN LIGHT - Ready!', yellow: 'YELLOW LIGHT - Almost Ready', red: 'RED LIGHT - Let\'s Work on It' };

        doc.rect(50, doc.y, 500, 40).fill(colors[lead.readiness_level] || '#666');
        doc.fillColor('white').fontSize(18).text(labels[lead.readiness_level] || 'Results', 60, doc.y - 30, { width: 480, align: 'center' });
        doc.fillColor('black');
        doc.moveDown(2);

        // Client info
        doc.fontSize(16).text('Prepared For:', { underline: true });
        doc.fontSize(12).text(`${lead.first_name} ${lead.last_name}`);
        if (lead.has_coborrower) {
            doc.text(`& ${lead.coborrower_first_name} ${lead.coborrower_last_name}`);
        }
        doc.moveDown();

        // Score
        doc.fontSize(14).text(`Readiness Score: ${lead.readiness_score}/100`);
        doc.moveDown();

        // Affordability
        doc.fontSize(16).text('Your Affordability Range:', { underline: true });
        doc.moveDown(0.5);

        doc.fontSize(12);
        doc.fillColor('#22c55e').text(`Comfortable (32% DTI): Up to $${(lead.comfortable_price || 0).toLocaleString()} (~$${(lead.comfortable_payment || 0).toLocaleString()}/mo)`);
        doc.fillColor('#eab308').text(`Stretch (36% DTI): Up to $${(lead.stretch_price || 0).toLocaleString()} (~$${(lead.stretch_payment || 0).toLocaleString()}/mo)`);
        doc.fillColor('#ef4444').text(`Strained (40% DTI): Up to $${(lead.strained_price || 0).toLocaleString()} (~$${(lead.strained_payment || 0).toLocaleString()}/mo)`);
        doc.fillColor('black');
        doc.moveDown();

        // AI Summary
        if (lead.ai_summary) {
            doc.fontSize(16).text('Your Personalized Summary:', { underline: true });
            doc.moveDown(0.5);
            doc.fontSize(11).text(lead.ai_summary, { align: 'justify' });
            doc.moveDown();
        }

        // Action Items
        let actionItems = [];
        try { actionItems = JSON.parse(lead.action_items || '[]'); } catch (e) {}

        if (actionItems.length > 0) {
            doc.fontSize(16).text('Your Next Steps:', { underline: true });
            doc.moveDown(0.5);
            actionItems.forEach((item, index) => {
                doc.fontSize(12).text(`${index + 1}. ${item.title}`, { continued: false });
                doc.fontSize(10).text(item.description, { indent: 20 });
                doc.moveDown(0.5);
            });
        }

        // Team info
        doc.moveDown();
        doc.fontSize(16).text('Your Team:', { underline: true });
        doc.moveDown(0.5);

        if (agent) {
            doc.fontSize(12).text(`${agent.first_name} ${agent.last_name}`);
            if (agent.brokerage) doc.fontSize(10).text(agent.brokerage);
            doc.text(`${agent.phone || ''} | ${agent.email}`);
            doc.moveDown();
        }

        doc.fontSize(12).text('Kelly Sansom');
        doc.fontSize(10).text('ClearPath Utah Mortgage | NMLS #2510508');
        doc.text('(801) 891-1846 | hello@clearpathutah.com');

        // Footer
        doc.moveDown(2);
        doc.fontSize(8).text(`Generated on ${new Date().toLocaleDateString()}`, { align: 'center' });
        doc.text('This is an estimate and not a commitment to lend. Equal Housing Lender.', { align: 'center' });

        doc.end();

    } catch (error) {
        console.error('Error generating PDF:', error);
        res.status(500).json({ error: 'Failed to generate PDF' });
    }
});

// Email PDF report
router.get('/:leadId/email-report', async (req, res) => {
    const db = getDatabase();
    const lead = db.prepare('SELECT * FROM leads WHERE id = ?').get(req.params.leadId);

    if (!lead) {
        return res.status(404).render('error', {
            title: 'Not Found',
            message: 'Lead not found.'
        });
    }

    // Get agent
    let agent = null;
    if (lead.agent_id) {
        agent = db.prepare('SELECT * FROM agents WHERE id = ?').get(lead.agent_id);
    }

    try {
        // Generate PDF to buffer
        const pdfBuffer = await generatePDFBuffer(lead, agent);

        // Setup Mailgun
        const mailgun = new Mailgun(formData);
        const mg = mailgun.client({
            username: 'api',
            key: process.env.MAILGUN_API_KEY || 'key-missing'
        });

        const domain = process.env.MAILGUN_DOMAIN || 'mg.clearpathutah.com';
        const kellyEmail = process.env.KELLY_EMAIL || 'hello@clearpathutah.com';

        // Email to client
        const clientEmailData = {
            from: `ClearPath Utah Mortgage <noreply@${domain}>`,
            to: lead.email,
            subject: `Your Home Readiness Report - ${lead.first_name}`,
            html: `
                <h2>Hi ${lead.first_name}!</h2>
                <p>Thank you for completing the Utah Home Ready Check. Your personalized report is attached.</p>
                <p><strong>Your Readiness Score:</strong> ${lead.readiness_score}/100</p>
                <p><strong>Affordability Range:</strong> $${(lead.comfortable_price || 0).toLocaleString()} - $${(lead.strained_price || 0).toLocaleString()}</p>
                <p>Ready to take the next step? Reply to this email or call me at (801) 891-1846.</p>
                <p>Best,<br>Kelly Sansom<br>ClearPath Utah Mortgage<br>NMLS #2510508</p>
            `,
            attachment: {
                data: pdfBuffer,
                filename: `home-readiness-report-${lead.first_name.toLowerCase()}.pdf`
            }
        };

        await mg.messages.create(domain, clientEmailData);

        // Email to Kelly
        const kellyEmailData = {
            from: `Utah Home Ready Check <noreply@${domain}>`,
            to: kellyEmail,
            subject: `New Lead: ${lead.first_name} ${lead.last_name} - ${lead.readiness_level.toUpperCase()}`,
            html: `
                <h2>New Lead from Utah Home Ready Check</h2>
                <p><strong>Name:</strong> ${lead.first_name} ${lead.last_name}</p>
                <p><strong>Email:</strong> ${lead.email}</p>
                <p><strong>Phone:</strong> ${lead.phone || 'Not provided'}</p>
                <p><strong>Readiness Level:</strong> ${lead.readiness_level.toUpperCase()}</p>
                <p><strong>Readiness Score:</strong> ${lead.readiness_score}/100</p>
                <p><strong>Income:</strong> $${(lead.gross_annual_income || 0).toLocaleString()}</p>
                <p><strong>Comfortable Price:</strong> $${(lead.comfortable_price || 0).toLocaleString()}</p>
                <p><strong>Timeline:</strong> ${lead.timeline}</p>
                ${agent ? `<p><strong>Agent:</strong> ${agent.first_name} ${agent.last_name} (${agent.email})</p>` : ''}
            `,
            attachment: {
                data: pdfBuffer,
                filename: `home-readiness-report-${lead.first_name.toLowerCase()}-${lead.last_name.toLowerCase()}.pdf`
            }
        };

        await mg.messages.create(domain, kellyEmailData);

        // If there's an agent, email them too
        if (agent && agent.email) {
            const agentEmailData = {
                from: `Utah Home Ready Check <noreply@${domain}>`,
                to: agent.email,
                subject: `Your Lead: ${lead.first_name} ${lead.last_name} - Home Ready Report`,
                html: `
                    <h2>Your lead has completed the Home Ready Check!</h2>
                    <p><strong>Name:</strong> ${lead.first_name} ${lead.last_name}</p>
                    <p><strong>Email:</strong> ${lead.email}</p>
                    <p><strong>Phone:</strong> ${lead.phone || 'Not provided'}</p>
                    <p><strong>Readiness Level:</strong> ${lead.readiness_level.toUpperCase()}</p>
                    <p><strong>Readiness Score:</strong> ${lead.readiness_score}/100</p>
                    <p><strong>Comfortable Price:</strong> $${(lead.comfortable_price || 0).toLocaleString()}</p>
                    <p><strong>Timeline:</strong> ${lead.timeline}</p>
                    <p>The full report is attached. Kelly Sansom from ClearPath Utah Mortgage will be reaching out to help get them pre-approved.</p>
                `,
                attachment: {
                    data: pdfBuffer,
                    filename: `home-readiness-report-${lead.first_name.toLowerCase()}.pdf`
                }
            };

            await mg.messages.create(domain, agentEmailData);
        }

        // Redirect back to results with success message
        res.redirect(`/results/${lead.id}?emailed=true`);

    } catch (error) {
        console.error('Error emailing report:', error);
        res.redirect(`/results/${lead.id}?error=email`);
    }
});

// Helper function to generate PDF buffer
function generatePDFBuffer(lead, agent) {
    return new Promise((resolve, reject) => {
        const chunks = [];
        const doc = new PDFDocument({ margin: 50 });

        doc.on('data', chunk => chunks.push(chunk));
        doc.on('end', () => resolve(Buffer.concat(chunks)));
        doc.on('error', reject);

        // Header
        doc.fontSize(24).text('Utah Home Ready Check', { align: 'center' });
        doc.fontSize(14).text('Your Personalized Readiness Report', { align: 'center' });
        doc.moveDown();

        // Traffic light indicator
        const colors = { green: '#22c55e', yellow: '#eab308', red: '#ef4444' };
        const labels = { green: 'GREEN LIGHT - Ready!', yellow: 'YELLOW LIGHT - Almost Ready', red: 'RED LIGHT - Let\'s Work on It' };

        doc.rect(50, doc.y, 500, 40).fill(colors[lead.readiness_level] || '#666');
        doc.fillColor('white').fontSize(18).text(labels[lead.readiness_level] || 'Results', 60, doc.y - 30, { width: 480, align: 'center' });
        doc.fillColor('black');
        doc.moveDown(2);

        // Client info
        doc.fontSize(16).text('Prepared For:', { underline: true });
        doc.fontSize(12).text(`${lead.first_name} ${lead.last_name}`);
        if (lead.has_coborrower) {
            doc.text(`& ${lead.coborrower_first_name} ${lead.coborrower_last_name}`);
        }
        doc.moveDown();

        // Score
        doc.fontSize(14).text(`Readiness Score: ${lead.readiness_score}/100`);
        doc.moveDown();

        // Affordability
        doc.fontSize(16).text('Your Affordability Range:', { underline: true });
        doc.moveDown(0.5);

        doc.fontSize(12);
        doc.fillColor('#22c55e').text(`Comfortable (32% DTI): Up to $${(lead.comfortable_price || 0).toLocaleString()} (~$${(lead.comfortable_payment || 0).toLocaleString()}/mo)`);
        doc.fillColor('#eab308').text(`Stretch (36% DTI): Up to $${(lead.stretch_price || 0).toLocaleString()} (~$${(lead.stretch_payment || 0).toLocaleString()}/mo)`);
        doc.fillColor('#ef4444').text(`Strained (40% DTI): Up to $${(lead.strained_price || 0).toLocaleString()} (~$${(lead.strained_payment || 0).toLocaleString()}/mo)`);
        doc.fillColor('black');
        doc.moveDown();

        // AI Summary - strip HTML tags for PDF
        if (lead.ai_summary) {
            doc.fontSize(16).text('Your Personalized Summary:', { underline: true });
            doc.moveDown(0.5);
            const plainSummary = lead.ai_summary.replace(/<[^>]*>/g, '').replace(/&nbsp;/g, ' ');
            doc.fontSize(11).text(plainSummary, { align: 'justify' });
            doc.moveDown();
        }

        // Action Items
        let actionItems = [];
        try { actionItems = JSON.parse(lead.action_items || '[]'); } catch (e) {}

        if (actionItems.length > 0) {
            doc.fontSize(16).text('Your Next Steps:', { underline: true });
            doc.moveDown(0.5);
            actionItems.forEach((item, index) => {
                doc.fontSize(12).text(`${index + 1}. ${item.title}`, { continued: false });
                doc.fontSize(10).text(item.description, { indent: 20 });
                doc.moveDown(0.5);
            });
        }

        // Team info
        doc.moveDown();
        doc.fontSize(16).text('Your Team:', { underline: true });
        doc.moveDown(0.5);

        if (agent) {
            doc.fontSize(12).text(`${agent.first_name} ${agent.last_name}`);
            if (agent.brokerage) doc.fontSize(10).text(agent.brokerage);
            doc.text(`${agent.phone || ''} | ${agent.email}`);
            doc.moveDown();
        }

        doc.fontSize(12).text('Kelly Sansom');
        doc.fontSize(10).text('ClearPath Utah Mortgage | NMLS #2510508');
        doc.text('(801) 891-1846 | hello@clearpathutah.com');

        // Footer
        doc.moveDown(2);
        doc.fontSize(8).text(`Generated on ${new Date().toLocaleDateString()}`, { align: 'center' });
        doc.text('This is an estimate and not a commitment to lend. Equal Housing Lender.', { align: 'center' });

        doc.end();
    });
}

module.exports = router;
