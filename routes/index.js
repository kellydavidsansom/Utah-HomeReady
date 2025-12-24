const express = require('express');
const router = express.Router();
const { getDatabase } = require('../services/database');

// Homepage
router.get('/', (req, res) => {
    res.render('index', {
        title: 'Check Your Home Readiness'
    });
});

// Agent-branded start page
router.get('/agent/:slug', (req, res) => {
    const db = getDatabase();
    const agent = db.prepare('SELECT * FROM agents WHERE slug = ?').get(req.params.slug);

    if (!agent) {
        return res.status(404).render('error', {
            title: 'Agent Not Found',
            message: 'This agent page does not exist.'
        });
    }

    res.render('assessment/start', {
        title: `Home Ready Check with ${agent.first_name}`,
        agent
    });
});

// Start assessment
router.post('/agent/:slug/start', (req, res) => {
    const db = getDatabase();
    const agent = db.prepare('SELECT * FROM agents WHERE slug = ?').get(req.params.slug);

    if (!agent) {
        return res.status(404).json({ error: 'Agent not found' });
    }

    // Create initial lead record
    const result = db.prepare(`
        INSERT INTO leads (agent_id, first_name, last_name, email)
        VALUES (?, '', '', '')
    `).run(agent.id);

    res.redirect(`/assessment/${result.lastInsertRowid}`);
});

// Embed version for iframes
router.get('/agent/:slug/embed', (req, res) => {
    const db = getDatabase();
    const agent = db.prepare('SELECT * FROM agents WHERE slug = ?').get(req.params.slug);

    if (!agent) {
        return res.status(404).render('error', {
            title: 'Agent Not Found',
            message: 'This agent page does not exist.'
        });
    }

    res.render('assessment/embed', {
        title: `Home Ready Check`,
        agent,
        layout: false // No header/footer for embed
    });
});

module.exports = router;
