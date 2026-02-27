# WhatsApp Meter

Personal response-time analytics for WhatsApp. Connects to your WhatsApp Business account via the official Cloud API and measures how quickly you reply — across all your chats, automatically.

**Privacy-first**: only message timestamps and sender metadata are stored. Message content is never recorded.

![Node.js](https://img.shields.io/badge/node-%3E%3D18-green) ![License](https://img.shields.io/badge/license-MIT-blue)

---

## How it works

1. **WhatsApp Coexistence** links your existing WhatsApp Business app to Meta's Cloud API — your phone keeps working normally
2. **Webhooks** stream message metadata (timestamps, sender IDs) to a local server in real time
3. **History sync** pulls up to 6 months of existing chat metadata automatically
4. **The dashboard** calculates your personal response times and shows trends, hourly patterns, and per-chat breakdowns

You can also import older `.txt` chat exports for data beyond the 6-month sync window.

---

## Quick start

### Option A: Desktop app (recommended)

```bash
# 1. Clone and install
git clone <your-repo-url> whatsapp-meter
cd whatsapp-meter
npm install

# 2. Launch the app
npm start
```

The app opens a native window with a step-by-step setup wizard that walks you through everything — creating a Meta app, linking your phone number, and connecting webhooks. No terminal commands, no editing config files.

The app runs in your system tray so the webhook listener stays active even when you close the window.

### Option B: Web server (no Electron)

```bash
npm run dev
open http://localhost:3000
```

Same setup wizard, runs in your browser. Good for servers or if you don't need the desktop app wrapper.

---

## Requirements

- **Node.js 18+**
- **WhatsApp Business app** on your phone (the regular WhatsApp app won't work — you need the Business version)
- **A Meta Developer account** (free at [developers.facebook.com](https://developers.facebook.com))

The app automatically creates a public tunnel for webhooks — no need to set up ngrok or Cloudflare separately.

---

## Project structure

```
whatsapp-meter/
├── main.js            # Electron main process (desktop app)
├── server.js          # Express server — webhook + API + auto-tunnel
├── webhook.js         # WhatsApp Cloud API webhook handler
├── db.js              # SQLite metadata store (sql.js, pure JS)
├── package.json
├── .env.example       # Config template
├── .gitignore
└── public/
    └── index.html     # Dashboard + setup wizard (single-page app)
```

---

## Configuration

Configuration is handled automatically by the in-browser setup wizard. Values are saved to `.env`:

| Variable | Description |
|----------|-------------|
| `WHATSAPP_VERIFY_TOKEN` | Random string set during webhook setup |
| `WHATSAPP_APP_SECRET` | From your Meta app's Settings → Basic |
| `MY_PHONE_NUMBER` | Your WhatsApp Business number (digits only, e.g. `447700900123`) |
| `PORT` | Server port (default: `3000`) |

---

## Importing older chat data

For messages older than the 6-month Coexistence sync window, you can import WhatsApp `.txt` exports:

1. Open a WhatsApp chat → ⋮ → More → Export chat → Without media
2. You'll get a `.txt` file
3. On the dashboard home screen, drag and drop the file (or click to browse)

The parser handles multiple date formats and locales automatically. Imported data is merged with webhook data in the same database.

---

## What gets stored

The SQLite database (`meter.db`) contains two tables:

**messages** — one row per message:
- `timestamp` (Unix epoch)
- `sender_phone` / `sender_name`
- `direction` (in/out)
- `chat_id`
- `msg_type` (text, image, etc.)
- `source` (webhook, echo, history, import)

**contacts** — phone-to-name mapping

**What is NOT stored**: message text, media, read receipts, or any content.

---

## API endpoints

| Endpoint | Method | Description |
|----------|--------|-------------|
| `/webhook` | GET | Meta webhook verification |
| `/webhook` | POST | Incoming webhook events |
| `/api/messages` | GET | Message metadata (supports `?from=`, `?to=`, `?chat=` filters) |
| `/api/chats` | GET | List of chats with message counts |
| `/api/contacts` | GET | Known contacts |
| `/api/stats` | GET | High-level stats (total messages, date range) |
| `/api/import` | POST | Import a `.txt` export (send raw text, set `X-Chat-Name` header) |
| `/api/config-status` | GET | Check if app is configured |
| `/api/setup` | POST | Save configuration from setup wizard |
| `/api/tunnel` | POST | Start auto-tunnel, returns public URL |
| `/api/tunnel-status` | GET | Check tunnel status |
| `/api/webhook-status` | GET | Check if Meta has verified the webhook |

---

## Dashboard features

- **Responsiveness grade** (A+ to F) based on your median response time
- **Trend chart** — response times over days/weeks/months
- **Distribution chart** — how your response times are spread
- **Hourly heatmap** — when you're fastest and slowest
- **Day-of-week breakdown** — your best and worst days
- **Per-chat table** — response times for each conversation
- **Per-contact table** — response times for each person

---

## Building for distribution

```bash
# macOS (.dmg)
npm run build

# Windows (.exe installer)
npm run build:win

# Linux (.AppImage)
npm run build:linux
```

Requires `electron-builder` (included in devDependencies).

---

## Architecture notes

- **sql.js** is used instead of native SQLite bindings — no C++ compilation needed, runs anywhere Node.js runs
- **localtunnel** provides automatic public URLs — no ngrok or Cloudflare setup needed
- The database auto-saves to disk every 30 seconds and on each webhook event
- Webhook signature validation uses `X-Hub-Signature-256` with HMAC-SHA256
- The server responds `200` to webhooks immediately, then processes asynchronously
- All dashboard computation happens client-side — the server only serves raw metadata
- The Electron wrapper runs the server as a child process and keeps it alive in the system tray

---

## License

MIT
