const express = require('express');
const router = express.Router();
const bcrypt = require('bcryptjs');
const { getDatabase } = require('../services/database');

// Middleware to check agent auth
function requireAgentAuth(req, res, next) {
    if (!req.session.agentId) {
        return res.redirect('/agent-portal/login');
    }
    next();
}

// Login page
router.get('/login', (req, res) => {
    res.render('agent-portal/login', {
        title: 'Agent Login',
        error: req.query.error
    });
});

// Process login
router.post('/login', async (req, res) => {
    const db = getDatabase();
    const { email, password } = req.body;

    const agent = db.prepare('SELECT * FROM agents WHERE email = ?').get(email);

    if (!agent) {
        return res.redirect('/agent-portal/login?error=Invalid email or password');
    }

    const validPassword = await bcrypt.compare(password, agent.password_hash);
    if (!validPassword) {
        return res.redirect('/agent-portal/login?error=Invalid email or password');
    }

    req.session.agentId = agent.id;
    res.redirect('/agent-portal/dashboard');
});

// Logout
router.get('/logout', (req, res) => {
    req.session.destroy();
    res.redirect('/agent-portal/login');
});

// Dashboard
router.get('/dashboard', requireAgentAuth, (req, res) => {
    const db = getDatabase();
    const agent = db.prepare('SELECT * FROM agents WHERE id = ?').get(req.session.agentId);

    // Get recent leads
    const leads = db.prepare(`
        SELECT * FROM leads
        WHERE agent_id = ?
        ORDER BY created_at DESC
        LIMIT 10
    `).all(agent.id);

    // Get stats
    const stats = db.prepare(`
        SELECT
            COUNT(*) as total,
            SUM(CASE WHEN readiness_level = 'green' THEN 1 ELSE 0 END) as green,
            SUM(CASE WHEN readiness_level = 'yellow' THEN 1 ELSE 0 END) as yellow,
            SUM(CASE WHEN readiness_level = 'red' THEN 1 ELSE 0 END) as red
        FROM leads
        WHERE agent_id = ?
    `).get(agent.id);

    res.render('agent-portal/dashboard', {
        title: 'Agent Dashboard',
        agent,
        leads,
        stats
    });
});

// All leads
router.get('/leads', requireAgentAuth, (req, res) => {
    const db = getDatabase();
    const agent = db.prepare('SELECT * FROM agents WHERE id = ?').get(req.session.agentId);

    const leads = db.prepare(`
        SELECT * FROM leads
        WHERE agent_id = ?
        ORDER BY created_at DESC
    `).all(agent.id);

    res.render('agent-portal/leads', {
        title: 'Your Leads',
        agent,
        leads
    });
});

// Lead detail
router.get('/leads/:id', requireAgentAuth, (req, res) => {
    const db = getDatabase();
    const agent = db.prepare('SELECT * FROM agents WHERE id = ?').get(req.session.agentId);

    const lead = db.prepare(`
        SELECT * FROM leads
        WHERE id = ? AND agent_id = ?
    `).get(req.params.id, agent.id);

    if (!lead) {
        return res.status(404).render('error', {
            title: 'Not Found',
            message: 'Lead not found.'
        });
    }

    // Parse JSON fields
    let actionItems = [];
    let targetCounties = [];
    try {
        actionItems = JSON.parse(lead.action_items || '[]');
        targetCounties = JSON.parse(lead.target_counties || '[]');
    } catch (e) {}

    res.render('agent-portal/lead-detail', {
        title: `${lead.first_name} ${lead.last_name}`,
        agent,
        lead,
        actionItems,
        targetCounties
    });
});

// Settings
router.get('/settings', requireAgentAuth, (req, res) => {
    const db = getDatabase();
    const agent = db.prepare('SELECT * FROM agents WHERE id = ?').get(req.session.agentId);

    res.render('agent-portal/settings', {
        title: 'Profile Settings',
        agent,
        success: req.query.success
    });
});

// Update settings
router.post('/settings', requireAgentAuth, (req, res) => {
    const db = getDatabase();
    const data = req.body;

    db.prepare(`
        UPDATE agents SET
            first_name = ?,
            last_name = ?,
            phone = ?,
            brokerage = ?,
            website = ?,
            bio = ?,
            facebook_url = ?,
            instagram_url = ?,
            linkedin_url = ?,
            updated_at = CURRENT_TIMESTAMP
        WHERE id = ?
    `).run(
        data.first_name,
        data.last_name,
        data.phone,
        data.brokerage,
        data.website,
        data.bio,
        data.facebook_url,
        data.instagram_url,
        data.linkedin_url,
        req.session.agentId
    );

    res.redirect('/agent-portal/settings?success=Profile updated');
});

// Embed code
router.get('/embed', requireAgentAuth, (req, res) => {
    const db = getDatabase();
    const agent = db.prepare('SELECT * FROM agents WHERE id = ?').get(req.session.agentId);
    const baseUrl = process.env.BASE_URL || 'https://homeready.clearpathutah.com';

    res.render('agent-portal/embed', {
        title: 'Embed Code',
        agent,
        baseUrl
    });
});

module.exports = router;
