require('dotenv').config();

const express = require('express');
const session = require('express-session');
const path = require('path');
const { initDatabase } = require('./services/database');

const app = express();
const PORT = process.env.PORT || 3000;

// Initialize database
initDatabase();

// View engine setup
app.set('view engine', 'ejs');
app.set('views', path.join(__dirname, 'views'));

// Middleware
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(express.static(path.join(__dirname, 'public')));

// Session configuration
app.use(session({
    secret: process.env.SESSION_SECRET || 'utah-home-ready-secret',
    resave: false,
    saveUninitialized: false,
    cookie: {
        secure: process.env.NODE_ENV === 'production',
        httpOnly: true,
        maxAge: 24 * 60 * 60 * 1000 // 24 hours
    }
}));

// Make session available to templates
app.use((req, res, next) => {
    res.locals.session = req.session;
    res.locals.baseUrl = process.env.BASE_URL || `http://localhost:${PORT}`;
    next();
});

// Routes
app.use('/', require('./routes/index'));
app.use('/assessment', require('./routes/assessment'));
app.use('/results', require('./routes/results'));
app.use('/preapproval', require('./routes/preapproval'));
app.use('/help', require('./routes/help'));
app.use('/agent-portal', require('./routes/agentPortal'));
app.use('/admin', require('./routes/admin'));

// Health check for Railway
app.get('/health', (req, res) => {
    res.status(200).json({ status: 'healthy' });
});

// 404 handler
app.use((req, res) => {
    res.status(404).render('error', {
        title: 'Page Not Found',
        message: 'The page you are looking for does not exist.'
    });
});

// Error handler
app.use((err, req, res, next) => {
    console.error('Error:', err);
    res.status(500).render('error', {
        title: 'Something went wrong',
        message: process.env.NODE_ENV === 'production'
            ? 'An unexpected error occurred.'
            : err.message
    });
});

app.listen(PORT, () => {
    console.log(`Utah Home Ready Check running on port ${PORT}`);
    console.log(`Local: http://localhost:${PORT}`);
});
