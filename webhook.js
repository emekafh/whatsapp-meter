// ══════════════════════════════════════════
// WhatsApp Cloud API Webhook Handler
// Processes incoming messages + outgoing echoes
// PRIVACY: Only extracts metadata — message text is NEVER stored
// ══════════════════════════════════════════
const crypto = require('crypto');
const { insertMessage } = require('./db');

const MY_PHONE = (process.env.MY_PHONE_NUMBER || '').replace(/[^0-9]/g, '');

// ── Verify webhook (GET) — Meta sends this during setup ──
function verifyWebhook(req, res) {
    const mode = req.query['hub.mode'];
    const token = req.query['hub.verify_token'];
    const challenge = req.query['hub.challenge'];

    if (mode === 'subscribe' && token === process.env.WHATSAPP_VERIFY_TOKEN) {
        console.log('[webhook] Verification successful');
        return res.status(200).send(challenge);
    }
    console.warn('[webhook] Verification failed — token mismatch');
    return res.sendStatus(403);
}

// ── Validate X-Hub-Signature-256 ──
function validateSignature(req) {
    const secret = process.env.WHATSAPP_APP_SECRET;
    if (!secret) return true; // skip validation if no secret configured (dev mode)

    const sig = req.headers['x-hub-signature-256'];
    if (!sig) return false;

    const expected = 'sha256=' + crypto.createHmac('sha256', secret).update(req.rawBody || JSON.stringify(req.body)).digest('hex');
    return crypto.timingSafeEqual(Buffer.from(sig), Buffer.from(expected));
}

// ── Process webhook (POST) ──
function handleWebhook(req, res) {
    // Always respond 200 quickly to avoid retries
    res.sendStatus(200);

    if (!validateSignature(req)) {
        console.warn('[webhook] Invalid signature — ignoring');
        return;
    }

    const body = req.body;
    if (body.object !== 'whatsapp_business_account') return;

    for (const entry of body.entry || []) {
        for (const change of entry.changes || []) {
            const value = change.value;
            if (!value) continue;

            const myPhoneId = value.metadata?.phone_number_id;
            const myDisplayNumber = value.metadata?.display_phone_number?.replace(/[^0-9]/g, '');

            // ── Incoming messages (field: "messages") ──
            if (change.field === 'messages' && value.messages) {
                const contactMap = {};
                for (const c of value.contacts || []) {
                    contactMap[c.wa_id] = c.profile?.name || c.wa_id;
                }

                for (const msg of value.messages) {
                    const senderPhone = msg.from?.replace(/[^0-9]/g, '');
                    const isFromMe = senderPhone === MY_PHONE || senderPhone === myDisplayNumber;

                    insertMessage({
                        id: msg.id,
                        timestamp: parseInt(msg.timestamp, 10),
                        senderPhone: senderPhone,
                        senderName: contactMap[msg.from] || null,
                        recipientPhone: isFromMe ? null : myDisplayNumber,
                        direction: isFromMe ? 'out' : 'in',
                        chatId: senderPhone, // for 1:1 chats, the chat ID is the other party's number
                        msgType: msg.type || 'text',
                        source: 'webhook'
                    });
                }
            }

            // ── Outgoing echoes (field: "smb_message_echoes") — messages YOU sent via Business app ──
            if (change.field === 'smb_message_echoes' && value.message_echoes) {
                for (const echo of value.message_echoes) {
                    const toPhone = echo.to?.replace(/[^0-9]/g, '');

                    insertMessage({
                        id: echo.id,
                        timestamp: parseInt(echo.timestamp, 10),
                        senderPhone: myDisplayNumber || MY_PHONE,
                        senderName: 'Me',
                        recipientPhone: toPhone,
                        direction: 'out',
                        chatId: toPhone, // chat is identified by the other party
                        msgType: echo.type || 'text',
                        source: 'echo'
                    });
                }
            }

            // ── History sync (field: "messages" with source: history) ──
            // This fires during initial 6-month history sync from Coexistence
            if (change.field === 'history' && value.messages) {
                for (const msg of value.messages) {
                    const senderPhone = msg.from?.replace(/[^0-9]/g, '');
                    const isFromMe = senderPhone === MY_PHONE || senderPhone === myDisplayNumber;

                    insertMessage({
                        id: msg.id || `hist_${msg.timestamp}_${senderPhone}`,
                        timestamp: parseInt(msg.timestamp, 10),
                        senderPhone: senderPhone,
                        senderName: null,
                        recipientPhone: isFromMe ? msg.to?.replace(/[^0-9]/g, '') : myDisplayNumber,
                        direction: isFromMe ? 'out' : 'in',
                        chatId: isFromMe ? msg.to?.replace(/[^0-9]/g, '') : senderPhone,
                        msgType: msg.type || 'text',
                        source: 'history'
                    });
                }
            }
        }
    }
}

module.exports = { verifyWebhook, handleWebhook };
