// ══════════════════════════════════════════
// WhatsApp Meter — Server
// Webhook receiver + Dashboard API + Static file server + Setup API + Auto-tunnel
// ══════════════════════════════════════════
require('dotenv').config();
const express = require('express');
const path = require('path');
const fs = require('fs');
const { verifyWebhook, handleWebhook } = require('./webhook');
const { init: initDb, getAllMessages, getChats, getContacts, getStats, bulkInsert } = require('./db');

const app = express();
const PORT = process.env.PORT || 3000;

// ── Global state for setup flow ──
let tunnelInstance = null;
let tunnelUrl = null;
let webhookVerified = false;      // set true when Meta sends a valid GET /webhook
let firstMessageReceived = false; // set true when first webhook POST arrives

// ── Raw body for signature validation ──
app.use(express.json({
    verify: (req, res, buf) => { req.rawBody = buf; }
}));

// ── Static files (dashboard) ──
app.use(express.static(path.join(__dirname, 'public')));

// ══════════════════════════════════════════
// SETUP API — in-browser configuration
// ══════════════════════════════════════════

// Check if .env is configured (has real values, not placeholders)
function isConfigured() {
    const phone = (process.env.MY_PHONE_NUMBER || '').replace(/[^0-9]/g, '');
    const secret = process.env.WHATSAPP_APP_SECRET || '';
    const token = process.env.WHATSAPP_VERIFY_TOKEN || '';
    return phone.length >= 5 && secret.length >= 10 && token.length >= 5
        && !secret.includes('your-') && !token.includes('your-');
}

app.get('/api/config-status', (req, res) => {
    res.json({ configured: isConfigured() });
});

app.post('/api/setup', express.json(), (req, res) => {
    try {
        const { phone, secret, verifyToken, tunnelUrl } = req.body;
        if (!phone || !secret || !verifyToken) {
            return res.status(400).json({ ok: false, error: 'Phone, secret, and verify token are required.' });
        }

        const cleanPhone = phone.replace(/[^0-9]/g, '');
        const envContent = `# WhatsApp Meter Configuration
# Saved from in-browser setup on ${new Date().toISOString()}

WHATSAPP_VERIFY_TOKEN=${verifyToken.trim()}
WHATSAPP_APP_SECRET=${secret.trim()}
MY_PHONE_NUMBER=${cleanPhone}
PORT=${PORT}
`;

        const envPath = path.join(__dirname, '.env');
        fs.writeFileSync(envPath, envContent);

        // Hot-reload env vars so the webhook handler picks them up immediately
        process.env.WHATSAPP_VERIFY_TOKEN = verifyToken.trim();
        process.env.WHATSAPP_APP_SECRET = secret.trim();
        process.env.MY_PHONE_NUMBER = cleanPhone;

        console.log(`[setup] Configuration saved — phone: ${cleanPhone}, webhook ready.`);
        res.json({ ok: true });
    } catch (e) {
        console.error('[setup] Error:', e);
        res.status(500).json({ ok: false, error: e.message });
    }
});

// ══════════════════════════════════════════
// TUNNEL API — auto-creates a public URL for webhooks
// ══════════════════════════════════════════

app.post('/api/tunnel', async (req, res) => {
    try {
        // If tunnel already running, return existing URL
        if (tunnelUrl && tunnelInstance) {
            return res.json({ ok: true, url: tunnelUrl });
        }

        const localtunnel = require('localtunnel');
        console.log('[tunnel] Starting localtunnel...');

        tunnelInstance = await localtunnel({ port: PORT });
        tunnelUrl = tunnelInstance.url;

        console.log(`[tunnel] Public URL: ${tunnelUrl}`);

        tunnelInstance.on('close', () => {
            console.log('[tunnel] Tunnel closed');
            tunnelUrl = null;
            tunnelInstance = null;
        });

        tunnelInstance.on('error', (err) => {
            console.error('[tunnel] Error:', err.message);
        });

        res.json({ ok: true, url: tunnelUrl });
    } catch (e) {
        console.error('[tunnel] Failed to start:', e.message);
        res.status(500).json({ ok: false, error: e.message });
    }
});

app.get('/api/tunnel-status', (req, res) => {
    res.json({
        active: !!tunnelUrl,
        url: tunnelUrl || null
    });
});

// ══════════════════════════════════════════
// WEBHOOK STATUS — tracks setup verification progress
// ══════════════════════════════════════════

app.get('/api/webhook-status', (req, res) => {
    res.json({
        verified: webhookVerified,
        firstMessage: firstMessageReceived
    });
});

// ══════════════════════════════════════════
// WEBHOOK ENDPOINTS (with verification tracking)
// ══════════════════════════════════════════

// Wrap the original verifyWebhook to also track verification state
app.get('/webhook', (req, res) => {
    const mode = req.query['hub.mode'];
    const token = req.query['hub.verify_token'];

    if (mode === 'subscribe' && token === process.env.WHATSAPP_VERIFY_TOKEN) {
        webhookVerified = true;
        console.log('[webhook] ✅ Verification successful — Meta confirmed the webhook!');
    }
    // Delegate to the original handler
    verifyWebhook(req, res);
});

// Wrap the original handleWebhook to track first message received
app.post('/webhook', (req, res) => {
    if (!firstMessageReceived) {
        const body = req.body;
        if (body && body.object === 'whatsapp_business_account') {
            firstMessageReceived = true;
            console.log('[webhook] ✅ First webhook event received — data is flowing!');
        }
    }
    // Delegate to the original handler
    handleWebhook(req, res);
});

// ══════════════════════════════════════════
// DASHBOARD API — serves only metadata, never message content
// ══════════════════════════════════════════

app.get('/api/messages', (req, res) => {
    const { from, to, chat } = req.query;
    const MY_PHONE = (process.env.MY_PHONE_NUMBER || '').replace(/[^0-9]/g, '');
    const messages = getAllMessages({
        from: from ? parseInt(from, 10) : undefined,
        to: to ? parseInt(to, 10) : undefined,
        chat: chat || undefined
    });

    const mapped = messages.map(m => ({
        timestamp: m.timestamp,
        sender: m.direction === 'out' ? 'Me' : (m.sender_name || m.sender_phone),
        chat: m.chat_id,
        direction: m.direction
    }));

    res.json({ messages: mapped, myPhone: MY_PHONE });
});

app.get('/api/chats', (req, res) => {
    res.json(getChats());
});

app.get('/api/contacts', (req, res) => {
    res.json(getContacts());
});

app.get('/api/stats', (req, res) => {
    res.json(getStats());
});

// ── File import endpoint — for uploading .txt exports as a fallback ──
app.post('/api/import', express.text({ limit: '50mb', type: '*/*' }), (req, res) => {
    try {
        const text = req.body;
        const chatName = req.headers['x-chat-name'] || 'Imported Chat';
        const msgs = parseTxtExport(text, chatName);
        if (msgs.length === 0) return res.status(400).json({ error: 'No messages parsed from file' });
        bulkInsert(msgs);
        res.json({ imported: msgs.length, chat: chatName });
    } catch (e) {
        console.error('[import] Error:', e);
        res.status(500).json({ error: e.message });
    }
});

// ══════════════════════════════════════════
// .TXT EXPORT PARSER (fallback for manual imports)
// Same privacy-first approach — message content discarded immediately
// ══════════════════════════════════════════
function cleanLine(l) {
    return l.replace(/[\u200e\u200f\u200b\u200c\u200d\u202a-\u202e\u2066-\u2069\ufeff\u00a0]/g, '')
            .replace(/^~/, '').replace(/\r/g, '').trim();
}

const PATS = [
    /^\[(\d{1,2}\/\d{1,2}\/\d{2,4}),\s+(\d{1,2}:\d{2}:\d{2})\]\s+(.+?):\s/,
    /^\[(\d{1,2}\/\d{1,2}\/\d{2,4}),\s+(\d{1,2}:\d{2}:\d{2}\s*[APap][Mm])\]\s+(.+?):\s/,
    /^\[(\d{1,2}\/\d{1,2}\/\d{2,4}),\s+(\d{1,2}:\d{2}\s*[APap]?[Mm]?)\]\s+(.+?):\s/,
    /^(\d{1,2}\/\d{1,2}\/\d{2,4}),?\s+(\d{1,2}:\d{2}(?::\d{2})?\s*[APap][Mm])\s*[-\u2013]\s*(.+?):\s/,
    /^(\d{1,2}\/\d{1,2}\/\d{2,4}),?\s+(\d{1,2}:\d{2}(?::\d{2})?)\s*[-\u2013]\s*(.+?):\s/,
];
const SYS_SENDERS = new Set(['together', 'system', 'whatsapp']);

function detectDDMM(lines) {
    for (const r of lines) {
        const l = cleanLine(r);
        const m = l.match(/(\d{1,2})\/(\d{1,2})\/(\d{2,4})/);
        if (m) {
            if (parseInt(m[1]) > 12) return true;
            if (parseInt(m[2]) > 12) return false;
        }
    }
    return true;
}

function parseImportDate(ds, ts, ddmm) {
    ds = ds.replace(/\./g, '/');
    const parts = ds.split('/');
    let y, mo, d;
    if (parts.length === 3) {
        const a = +parts[0], b = +parts[1], c = +parts[2];
        if (ddmm) { d = a; mo = b; y = c; } else { mo = a; d = b; y = c; }
    }
    if (y < 100) y += 2000;
    ts = ts.trim();
    const pm = /pm/i.test(ts), am = /am/i.test(ts);
    const tp = ts.replace(/\s*[APap][Mm]/i, '').split(':');
    let h = +tp[0]; const mi = +tp[1], s = tp[2] ? +tp[2] : 0;
    if (pm && h < 12) h += 12; if (am && h === 12) h = 0;
    return new Date(y, mo - 1, d, h, mi, s);
}

function parseTxtExport(text, chatName) {
    const lines = text.split('\n');
    const ddmm = detectDDMM(lines);
    const msgs = [];
    let counter = 0;

    for (const raw of lines) {
        const line = cleanLine(raw);
        if (!line) continue;
        for (const pat of PATS) {
            const m = line.match(pat);
            if (m) {
                const dt = parseImportDate(m[1], m[2], ddmm);
                const sender = m[3].trim();
                if (!isNaN(dt.getTime()) && !SYS_SENDERS.has(sender.toLowerCase())) {
                    const ts = Math.floor(dt.getTime() / 1000);
                    msgs.push({
                        id: `import_${chatName}_${ts}_${counter++}`,
                        timestamp: ts,
                        senderPhone: sender,
                        senderName: sender,
                        recipientPhone: null,
                        direction: 'unknown',
                        chatId: chatName,
                        msgType: 'text',
                        source: 'import'
                    });
                }
                break;
            }
        }
    }
    return msgs;
}

// ══════════════════════════════════════════
// START
// ══════════════════════════════════════════
initDb().then(() => {
    const server = app.listen(PORT, () => {
        console.log(`
╔══════════════════════════════════════════╗
║          WhatsApp Meter v1.0             ║
╠══════════════════════════════════════════╣
║  Dashboard:  http://localhost:${PORT}        ║
║  Webhook:    http://localhost:${PORT}/webhook ║
╠══════════════════════════════════════════╣
║  Privacy: No message content is stored   ║
║  Only timestamps + sender metadata       ║
╚══════════════════════════════════════════╝
`);
        if (isConfigured()) {
            console.log('  Status: Configured and ready for webhooks.\n');
        } else {
            console.log('  Status: Not yet configured.');
            console.log('  Open http://localhost:' + PORT + ' to run the setup wizard.\n');
        }
        const stats = getStats();
        if (stats.totalMessages > 0) {
            console.log(`  Database: ${stats.totalMessages.toLocaleString()} messages across ${stats.totalChats} chats`);
            const earliest = stats.earliest ? new Date(stats.earliest * 1000).toLocaleDateString() : 'n/a';
            const latest = stats.latest ? new Date(stats.latest * 1000).toLocaleDateString() : 'n/a';
            console.log(`  Range: ${earliest} → ${latest}\n`);
        }
    });

    // Graceful shutdown — close tunnel + server
    const shutdown = () => {
        console.log('\n[shutdown] Cleaning up...');
        if (tunnelInstance) {
            tunnelInstance.close();
            console.log('[shutdown] Tunnel closed');
        }
        server.close(() => {
            console.log('[shutdown] Server stopped');
            process.exit(0);
        });
    };

    process.on('SIGINT', shutdown);
    process.on('SIGTERM', shutdown);
}).catch(e => { console.error('Failed to init DB:', e); process.exit(1); });
