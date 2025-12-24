const Database = require('better-sqlite3');
const path = require('path');
const fs = require('fs');

const DB_PATH = process.env.DATABASE_URL || path.join(__dirname, '../data/utah-home-ready.db');

let db;

function getDatabase() {
    if (!db) {
        // Ensure data directory exists
        const dataDir = path.dirname(DB_PATH);
        if (!fs.existsSync(dataDir)) {
            fs.mkdirSync(dataDir, { recursive: true });
        }
        db = new Database(DB_PATH);
        db.pragma('journal_mode = WAL');
    }
    return db;
}

function initDatabase() {
    const db = getDatabase();

    // Agents table
    db.exec(`
        CREATE TABLE IF NOT EXISTS agents (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            slug TEXT UNIQUE NOT NULL,
            first_name TEXT NOT NULL,
            last_name TEXT NOT NULL,
            email TEXT NOT NULL,
            phone TEXT,
            brokerage TEXT,
            website TEXT,
            bio TEXT,
            logo_url TEXT,
            headshot_url TEXT,
            facebook_url TEXT,
            instagram_url TEXT,
            linkedin_url TEXT,
            password_hash TEXT NOT NULL,
            created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
            updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
        )
    `);

    // Leads table
    db.exec(`
        CREATE TABLE IF NOT EXISTS leads (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            agent_id INTEGER,

            -- Borrower info
            first_name TEXT NOT NULL,
            last_name TEXT NOT NULL,
            email TEXT NOT NULL,
            phone TEXT,
            street_address TEXT,
            city TEXT,
            state TEXT DEFAULT 'Utah',
            zip TEXT,
            time_at_address TEXT,

            -- Co-borrower info
            has_coborrower INTEGER DEFAULT 0,
            coborrower_first_name TEXT,
            coborrower_last_name TEXT,
            coborrower_email TEXT,

            -- Financial info
            gross_annual_income REAL,
            coborrower_gross_annual_income REAL,
            employment_type TEXT,
            coborrower_employment_type TEXT,
            monthly_debt_payments TEXT,
            credit_score_range TEXT,
            down_payment_saved REAL,
            down_payment_sources TEXT,

            -- Buying plans
            timeline TEXT,
            target_counties TEXT,
            first_time_buyer TEXT,
            va_eligible TEXT,
            current_housing TEXT,

            -- Calculated results
            readiness_score INTEGER,
            readiness_level TEXT,
            red_light_reason TEXT,
            comfortable_price REAL,
            stretch_price REAL,
            strained_price REAL,
            comfortable_payment REAL,
            stretch_payment REAL,
            strained_payment REAL,

            -- AI generated
            ai_summary TEXT,
            action_items TEXT,

            -- Google Drive
            google_drive_folder_id TEXT,
            google_drive_folder_url TEXT,

            -- Timestamps
            created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
            updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,

            FOREIGN KEY (agent_id) REFERENCES agents(id)
        )
    `);

    // Documents table
    db.exec(`
        CREATE TABLE IF NOT EXISTS documents (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            lead_id INTEGER NOT NULL,
            document_type TEXT NOT NULL,
            file_name TEXT NOT NULL,
            google_drive_file_id TEXT,
            google_drive_url TEXT,
            uploaded_at DATETIME DEFAULT CURRENT_TIMESTAMP,

            FOREIGN KEY (lead_id) REFERENCES leads(id)
        )
    `);

    // Credit analyses table
    db.exec(`
        CREATE TABLE IF NOT EXISTS credit_analyses (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            lead_id INTEGER NOT NULL,
            ai_summary_for_client TEXT,
            ai_full_report_for_kelly TEXT,
            google_drive_report_url TEXT,
            created_at DATETIME DEFAULT CURRENT_TIMESTAMP,

            FOREIGN KEY (lead_id) REFERENCES leads(id)
        )
    `);

    // Lead accounts table (for red light leads)
    db.exec(`
        CREATE TABLE IF NOT EXISTS lead_accounts (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            lead_id INTEGER NOT NULL UNIQUE,
            password_hash TEXT NOT NULL,
            created_at DATETIME DEFAULT CURRENT_TIMESTAMP,

            FOREIGN KEY (lead_id) REFERENCES leads(id)
        )
    `);

    console.log('Database initialized successfully');
}

function closeDatabase() {
    if (db) {
        db.close();
        db = null;
    }
}

module.exports = {
    getDatabase,
    initDatabase,
    closeDatabase
};
