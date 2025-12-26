const initSqlJs = require('sql.js');
const path = require('path');
const fs = require('fs');

const DB_PATH = process.env.DATABASE_URL || path.join(__dirname, '../data/utah-home-ready.db');

let db;
let SQL;

async function initSQL() {
    if (!SQL) {
        SQL = await initSqlJs();
    }
    return SQL;
}

function getDatabase() {
    if (!db) {
        throw new Error('Database not initialized. Call initDatabase() first.');
    }
    return db;
}

async function initDatabase() {
    const SQL = await initSQL();

    // Ensure data directory exists
    const dataDir = path.dirname(DB_PATH);
    if (!fs.existsSync(dataDir)) {
        fs.mkdirSync(dataDir, { recursive: true });
    }

    // Load existing database or create new one
    try {
        if (fs.existsSync(DB_PATH)) {
            const buffer = fs.readFileSync(DB_PATH);
            db = new SQL.Database(buffer);
        } else {
            db = new SQL.Database();
        }
    } catch (e) {
        console.log('Creating new database...');
        db = new SQL.Database();
    }

    // Create tables
    db.run(`
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

    db.run(`
        CREATE TABLE IF NOT EXISTS leads (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            agent_id INTEGER,

            first_name TEXT NOT NULL,
            last_name TEXT NOT NULL,
            email TEXT NOT NULL,
            phone TEXT,
            street_address TEXT,
            city TEXT,
            state TEXT DEFAULT 'Utah',
            zip TEXT,
            time_at_address TEXT,

            has_coborrower INTEGER DEFAULT 0,
            coborrower_first_name TEXT,
            coborrower_last_name TEXT,
            coborrower_email TEXT,

            gross_annual_income REAL,
            coborrower_gross_annual_income REAL,
            employment_type TEXT,
            coborrower_employment_type TEXT,
            monthly_debt_payments TEXT,
            credit_score_range TEXT,
            down_payment_saved REAL,
            down_payment_sources TEXT,

            timeline TEXT,
            target_counties TEXT,
            first_time_buyer TEXT,
            va_eligible TEXT,
            current_housing TEXT,

            readiness_score INTEGER,
            readiness_level TEXT,
            red_light_reason TEXT,
            comfortable_price REAL,
            stretch_price REAL,
            strained_price REAL,
            comfortable_payment REAL,
            stretch_payment REAL,
            strained_payment REAL,

            ai_summary TEXT,
            action_items TEXT,

            google_drive_folder_id TEXT,
            google_drive_folder_url TEXT,

            created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
            updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,

            FOREIGN KEY (agent_id) REFERENCES agents(id)
        )
    `);

    db.run(`
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

    db.run(`
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

    db.run(`
        CREATE TABLE IF NOT EXISTS lead_accounts (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            lead_id INTEGER NOT NULL UNIQUE,
            password_hash TEXT NOT NULL,
            created_at DATETIME DEFAULT CURRENT_TIMESTAMP,

            FOREIGN KEY (lead_id) REFERENCES leads(id)
        )
    `);

    saveDatabase();
    console.log('Database initialized successfully');
}

function saveDatabase() {
    if (db) {
        const data = db.export();
        const buffer = Buffer.from(data);
        fs.writeFileSync(DB_PATH, buffer);
    }
}

function closeDatabase() {
    if (db) {
        saveDatabase();
        db.close();
        db = null;
    }
}

// Wrapper to provide better-sqlite3 compatible API
const dbWrapper = {
    prepare: function(sql) {
        return {
            run: function(...params) {
                if (params.length > 0) {
                    db.run(sql, params);
                } else {
                    db.run(sql);
                }
                saveDatabase();
                return { lastInsertRowid: db.exec("SELECT last_insert_rowid()")[0]?.values[0]?.[0] || 0, changes: db.getRowsModified() };
            },
            get: function(...params) {
                const stmt = db.prepare(sql);
                if (params.length > 0) {
                    stmt.bind(params);
                }
                if (stmt.step()) {
                    const row = stmt.getAsObject();
                    stmt.free();
                    return row;
                }
                stmt.free();
                return undefined;
            },
            all: function(...params) {
                const stmt = db.prepare(sql);
                if (params.length > 0) {
                    stmt.bind(params);
                }
                const results = [];
                while (stmt.step()) {
                    results.push(stmt.getAsObject());
                }
                stmt.free();
                return results;
            }
        };
    }
};

function getDatabaseWrapper() {
    if (!db) {
        throw new Error('Database not initialized');
    }
    return dbWrapper;
}

module.exports = {
    getDatabase: getDatabaseWrapper,
    initDatabase,
    closeDatabase,
    saveDatabase
};
