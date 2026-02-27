// ══════════════════════════════════════════
// WhatsApp Meter — Electron Main Process
// Starts Express server + auto-tunnel in background,
// opens the dashboard in a native app window
// ══════════════════════════════════════════
const { app, BrowserWindow, Tray, Menu, nativeImage, shell } = require('electron');
const path = require('path');
const { fork } = require('child_process');

let mainWindow = null;
let tray = null;
let serverProcess = null;
const PORT = 3000;

function createWindow() {
    mainWindow = new BrowserWindow({
        width: 1200,
        height: 820,
        minWidth: 800,
        minHeight: 600,
        titleBarStyle: 'hiddenInset',
        backgroundColor: '#f0f2f5',
        webPreferences: {
            nodeIntegration: false,
            contextIsolation: true
        },
        show: false
    });

    // Wait for server to be ready, then load
    waitForServer().then(() => {
        mainWindow.loadURL(`http://localhost:${PORT}`);
        mainWindow.once('ready-to-show', () => {
            mainWindow.show();
        });
    });

    mainWindow.on('close', (e) => {
        // Hide to tray instead of quitting (keeps webhook listener alive)
        if (!app.isQuitting) {
            e.preventDefault();
            mainWindow.hide();
        }
    });

    // Open external links in browser
    mainWindow.webContents.setWindowOpenHandler(({ url }) => {
        shell.openExternal(url);
        return { action: 'deny' };
    });
}

function startServer() {
    // Fork the Express server as a child process
    serverProcess = fork(path.join(__dirname, 'server.js'), [], {
        env: { ...process.env, PORT: String(PORT), ELECTRON: '1' },
        stdio: 'pipe'
    });

    serverProcess.stdout.on('data', (data) => {
        console.log('[server]', data.toString().trim());
    });

    serverProcess.stderr.on('data', (data) => {
        console.error('[server]', data.toString().trim());
    });
}

function waitForServer(attempts = 0) {
    return new Promise((resolve) => {
        const http = require('http');
        const check = () => {
            const req = http.get(`http://localhost:${PORT}/api/config-status`, (res) => {
                resolve();
            });
            req.on('error', () => {
                if (attempts < 50) {
                    setTimeout(() => check(), 200);
                    attempts++;
                } else {
                    resolve(); // give up waiting, try to load anyway
                }
            });
        };
        check();
    });
}

function createTray() {
    // Simple tray icon (green circle)
    const icon = nativeImage.createFromDataURL(
        'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAACAAAAAgCAYAAABzenr0AAAAhklEQVR4Ae3TIQ7CQBCF4b+7HYSA4ALcAMEN6k7ADTgBN0BxAfRKlmyCqJnMZN5kPvG0E8IvT6sRGqERGqERGqERGqH5FpoH0z7Ycbb0lYDrLfC4UOD4B3wBVws8LBTYvgA/WuB0ocD+Bfj8s8D2A/i5V6D4Nv/7d8FI/QfQCI3QCI3QiB+aFSsxsgcLDAAAAABJRU5ErkJggg=='
    );
    tray = new Tray(icon.resize({ width: 16, height: 16 }));
    tray.setToolTip('WhatsApp Meter — Running');

    const contextMenu = Menu.buildFromTemplate([
        { label: 'Open Dashboard', click: () => { mainWindow.show(); } },
        { type: 'separator' },
        { label: 'Quit', click: () => { app.isQuitting = true; app.quit(); } }
    ]);
    tray.setContextMenu(contextMenu);
    tray.on('click', () => mainWindow.show());
}

// ── App lifecycle ──
app.whenReady().then(() => {
    startServer();
    createWindow();
    createTray();
});

app.on('before-quit', () => {
    app.isQuitting = true;
    if (serverProcess) serverProcess.kill();
});

app.on('activate', () => {
    if (mainWindow) mainWindow.show();
});

app.on('window-all-closed', () => {
    // On macOS, keep app running in tray
    if (process.platform !== 'darwin') {
        app.isQuitting = true;
        app.quit();
    }
});
