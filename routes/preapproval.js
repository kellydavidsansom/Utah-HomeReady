const express = require('express');
const router = express.Router();
const { getDatabase } = require('../services/database');

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
router.post('/:leadId/submit', (req, res) => {
    // TODO: Handle document upload
    res.redirect(`/preapproval/${req.params.leadId}/status`);
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

    res.render('preapproval/status', {
        title: 'Pre-Approval Status',
        lead,
        agent
    });
});

module.exports = router;
