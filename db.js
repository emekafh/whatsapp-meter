// ══════════════════════════════════════════
// SQLite metadata store (sql.js — pure JS, no native deps)
// NEVER stores message content
// ══════════════════════════════════════════
const initSqlJs = require('sql.js');
const fs = require('fs');
const path = require('path');

const DB_PATH = path.join(__dirname, 'meter.db');

let _db = null;
let _ready = null;

function init() {
    if (_ready) return _ready;
    _ready = initSqlJs().then(SQL => {
        let data = null;
        if (fs.existsSync(DB_PATH)) {
            data = fs.readFileSync(DB_PATH);
        }
        _db = data ? new SQL.Database(data) : new SQL.Database();
        migrate();
        return _db;
    });
    return _ready;
}

function getDb() {
    if (!_db) throw new Error('Database not initialized — call init() first');
    return _db;
}

function save() {
    if (!_db) return;
    const data = _db.export();
    fs.writeFileSync(DB_PATH, Buffer.from(data));
}

// Auto-save every 30 seconds
setInterval(() => { try { save(); } catch(e) {} }, 30000);

function migrate() {
    _db.run(`
        CREATE TABLE IF NOT EXISTS messages (
            id TEXT PRIMARY KEY,
            timestamp INTEGER NOT NULL,
            sender_phone TEXT NOT NULL,
            sender_name TEXT,
            recipient_phone TEXT,
            direction TEXT NOT NULL,
            chat_id TEXT,
            msg_type TEXT DEFAULT 'text',
            source TEXT DEFAULT 'webhook'
        )
    `);
    _db.run(`CREATE INDEX IF NOT EXISTS idx_messages_ts ON messages(timestamp)`);
    _db.run(`CREATE INDEX IF NOT EXISTS idx_messages_sender ON messages(sender_phone)`);
    _db.run(`CREATE INDEX IF NOT EXISTS idx_messages_chat ON messages(chat_id)`);
    _db.run(`CREATE INDEX IF NOT EXISTS idx_messages_dir ON messages(direction)`);
    _db.run(`
        CREATE TABLE IF NOT EXISTS contacts (
            phone TEXT PRIMARY KEY,
            name TEXT NOT NULL,
            updated_at INTEGER DEFAULT (strftime('%s','now'))
        )
    `);
}

// ── Insert a message (idempotent — skips duplicates) ──
function insertMessage({ id, timestamp, senderPhone, senderName, recipientPhone, direction, chatId, msgType, source }) {
    const db = getDb();
    if (senderName && senderPhone) {
        db.run(`INSERT OR REPLACE INTO contacts (phone, name, updated_at) VALUES (?, ?, strftime('%s','now'))`,
               [senderPhone, senderName]);
    }
    db.run(`INSERT OR IGNORE INTO messages (id, timestamp, sender_phone, sender_name, recipient_phone, direction, chat_id, msg_type, source)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
           [id, timestamp, senderPhone, senderName || null, recipientPhone || null, direction, chatId || null, msgType || 'text', source || 'webhook']);
    save();
}

// ── Bulk insert from file import ──
function bulkInsert(rows) {
    const db = getDb();
    db.run('BEGIN TRANSACTION');
    try {
        for (const r of rows) {
            if (r.senderName && r.senderPhone) {
                db.run(`INSERT OR REPLACE INTO contacts (phone, name, updated_at) VALUES (?, ?, strftime('%s','now'))`,
                       [r.senderPhone, r.senderName]);
            }
            db.run(`INSERT OR IGNORE INTO messages (id, timestamp, sender_phone, sender_name, recipient_phone, direction, chat_id, msg_type, source)
                    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
                   [r.id, r.timestamp, r.senderPhone, r.senderName || null, r.recipientPhone || null, r.direction, r.chatId || null, r.msgType || 'text', r.source || 'import']);
        }
        db.run('COMMIT');
    } catch (e) {
        db.run('ROLLBACK');
        throw e;
    }
    save();
}

// ── Query helpers ──
function queryAll(sql, params = []) {
    const db = getDb();
    const stmt = db.prepare(sql);
    if (params.length) stmt.bind(params);
    const results = [];
    while (stmt.step()) results.push(stmt.getAsObject());
    stmt.free();
    return results;
}

function queryOne(sql, params = []) {
    const rows = queryAll(sql, params);
    return rows[0] || null;
}

// ── Query: all message metadata for dashboard ──
function getAllMessages({ from, to, chat } = {}) {
    let sql = `SELECT m.id, m.timestamp, m.sender_phone, COALESCE(m.sender_name, c.name, m.sender_phone) as sender_name,
                      m.recipient_phone, m.direction, m.chat_id, m.msg_type, m.source
               FROM messages m LEFT JOIN contacts c ON m.sender_phone = c.phone WHERE 1=1`;
    const params = [];
    if (from) { sql += ' AND m.timestamp >= ?'; params.push(from); }
    if (to) { sql += ' AND m.timestamp <= ?'; params.push(to); }
    if (chat) { sql += ' AND m.chat_id = ?'; params.push(chat); }
    sql += ' ORDER BY m.timestamp ASC';
    return queryAll(sql, params);
}

function getChats() {
    return queryAll(`SELECT chat_id, COUNT(*) as msg_count, MIN(timestamp) as first_msg, MAX(timestamp) as last_msg
                     FROM messages WHERE chat_id IS NOT NULL GROUP BY chat_id ORDER BY msg_count DESC`);
}

function getContacts() {
    return queryAll(`SELECT phone, name FROM contacts ORDER BY name`);
}

function getStats() {
    const total = queryOne('SELECT COUNT(*) as n FROM messages');
    const chats = queryOne('SELECT COUNT(DISTINCT chat_id) as n FROM messages');
    const contacts = queryOne('SELECT COUNT(*) as n FROM contacts');
    const range = queryOne('SELECT MIN(timestamp) as earliest, MAX(timestamp) as latest FROM messages');
    return {
        totalMessages: total ? total.n : 0,
        totalChats: chats ? chats.n : 0,
        totalContacts: contacts ? contacts.n : 0,
        earliest: range ? range.earliest : null,
        latest: range ? range.latest : null
    };
}

module.exports = { init, getDb, save, insertMessage, bulkInsert, getAllMessages, getChats, getContacts, getStats };
