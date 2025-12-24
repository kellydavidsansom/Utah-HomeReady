const express = require('express');
const router = express.Router();
const { getDatabase } = require('../services/database');
const { generateBoostIdeas } = require('../services/claude');

// Credit improvement portal
router.get('/:leadId/credit', (req, res) => {
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

    res.render('help/credit', {
        title: 'Credit Improvement Help',
        lead,
        agent
    });
});

// Income/down payment boost portal
router.get('/:leadId/boost', async (req, res) => {
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

    // Generate boost ideas
    let boostIdeas = null;
    try {
        boostIdeas = await generateBoostIdeas(lead);
    } catch (error) {
        console.error('Error generating boost ideas:', error);
    }

    res.render('help/boost', {
        title: 'Boost Your Buying Power',
        lead,
        agent,
        boostIdeas
    });
});

// Create account
router.get('/:leadId/create-account', (req, res) => {
    const db = getDatabase();
    const lead = db.prepare('SELECT * FROM leads WHERE id = ?').get(req.params.leadId);

    if (!lead) {
        return res.status(404).render('error', {
            title: 'Not Found',
            message: 'Lead not found.'
        });
    }

    res.render('help/create-account', {
        title: 'Create Your Account',
        lead
    });
});

router.post('/:leadId/create-account', async (req, res) => {
    const db = getDatabase();
    const bcrypt = require('bcryptjs');

    const lead = db.prepare('SELECT * FROM leads WHERE id = ?').get(req.params.leadId);
    if (!lead) {
        return res.status(404).json({ error: 'Lead not found' });
    }

    const { password } = req.body;
    const passwordHash = await bcrypt.hash(password, 10);

    db.prepare(`
        INSERT INTO lead_accounts (lead_id, password_hash)
        VALUES (?, ?)
        ON CONFLICT(lead_id) DO UPDATE SET password_hash = ?
    `).run(lead.id, passwordHash, passwordHash);

    req.session.leadId = lead.id;
    res.redirect(`/help/${lead.id}/dashboard`);
});

// Dashboard
router.get('/:leadId/dashboard', (req, res) => {
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

    res.render('help/dashboard', {
        title: 'Your Dashboard',
        lead,
        agent
    });
});

module.exports = router;
