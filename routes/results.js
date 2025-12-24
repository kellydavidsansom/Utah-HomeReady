const express = require('express');
const router = express.Router();
const { getDatabase } = require('../services/database');
const { generateAISummary, generateActionItems } = require('../services/claude');
const { sendToHighLevel } = require('../services/highlevel');

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
        downPaymentSources
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

module.exports = router;
