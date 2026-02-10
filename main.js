const { app, BrowserWindow, ipcMain, desktopCapturer, Menu } = require('electron');
const path = require('path');
const fs = require('fs');

let petWindow = null;
let chatBubbleWindow = null;
let settingsWindow = null;
let characterData = { isLive2DActive: true, live2dModelPath: 'assets/L2D/pink-devil/Pink devil.model3.json' };

// ========== Config Persistence ==========

const configPath = path.join(__dirname, 'config.json');

function loadConfigFile() {
    try {
        if (fs.existsSync(configPath)) {
            return JSON.parse(fs.readFileSync(configPath, 'utf-8'));
        }
    } catch (e) { console.warn('Failed to load config:', e.message); }
    return {};
}

function saveConfigFile(data) {
    try {
        const existing = loadConfigFile();
        const merged = { ...existing, ...data };
        fs.writeFileSync(configPath, JSON.stringify(merged, null, 2), 'utf-8');
        return true;
    } catch (e) { console.error('Failed to save config:', e.message); return false; }
}

// ========== App Lifecycle ==========

app.whenReady().then(() => {
    createSettingsWindow();
});

app.on('window-all-closed', () => {
    if (process.platform !== 'darwin') app.quit();
});

// ========== Settings Window ==========

function createSettingsWindow() {
    settingsWindow = new BrowserWindow({
        width: 480,
        height: 600,
        frame: true,
        resizable: false,
        webPreferences: {
            nodeIntegration: false,
            contextIsolation: true,
            preload: path.join(__dirname, 'preload.js')
        }
    });
    settingsWindow.loadFile('index.html');
    settingsWindow.on('closed', () => { settingsWindow = null; });
}

// ========== Pet Window ==========

ipcMain.handle('create-pet-window', async (event, data) => {
    try {
        if (petWindow && !petWindow.isDestroyed()) {
            petWindow.focus();
            return { success: true, message: 'already open' };
        }
        if (data) characterData = { ...characterData, ...data };

        petWindow = new BrowserWindow({
            width: 300, height: 300,
            frame: false, transparent: true, alwaysOnTop: true,
            resizable: true, minimizable: false, maximizable: false,
            fullscreenable: false, skipTaskbar: true,
            webPreferences: {
                nodeIntegration: false,
                contextIsolation: true,
                preload: path.join(__dirname, 'preload.js')
            }
        });
        petWindow.setAlwaysOnTop(true, 'screen-saver');
        petWindow.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true });
        petWindow.loadFile('desktop-pet.html');

        const { screen } = require('electron');
        const primaryDisplay = screen.getPrimaryDisplay();
        const { width, height } = primaryDisplay.workAreaSize;
        petWindow.setPosition(width - 220, height - 220);

        petWindow.on('closed', () => {
            petWindow = null;
            if (chatBubbleWindow && !chatBubbleWindow.isDestroyed()) chatBubbleWindow.close();
            if (settingsWindow && !settingsWindow.isDestroyed()) {
                settingsWindow.webContents.send('pet-window-closed');
            }
        });

        return { success: true };
    } catch (error) {
        return { success: false, error: error.message };
    }
});

ipcMain.handle('close-pet-window', async () => {
    try {
        if (petWindow && !petWindow.isDestroyed()) petWindow.close();
        return { success: true };
    } catch (error) {
        return { success: false, error: error.message };
    }
});

ipcMain.handle('update-pet-character', async (event, data) => {
    try {
        if (data) characterData = { ...characterData, ...data };
        if (petWindow && !petWindow.isDestroyed()) {
            petWindow.webContents.send('character-update', characterData);
        }
        return { success: true };
    } catch (error) {
        return { success: false, error: error.message };
    }
});

ipcMain.handle('get-character-data', async () => {
    return characterData;
});

// ========== Window Control ==========

ipcMain.handle('set-window-size', async (event, width, height) => {
    try {
        if (petWindow && !petWindow.isDestroyed()) petWindow.setSize(width, height);
        return { success: true };
    } catch (error) {
        return { success: false, error: error.message };
    }
});

ipcMain.handle('set-window-position', async (event, x, y) => {
    try {
        if (petWindow && !petWindow.isDestroyed()) petWindow.setPosition(x, y);
        return { success: true };
    } catch (error) {
        return { success: false, error: error.message };
    }
});

ipcMain.handle('get-window-bounds', async () => {
    if (petWindow && !petWindow.isDestroyed()) return petWindow.getBounds();
    return { x: 0, y: 0, width: 200, height: 200 };
});

ipcMain.handle('get-window-position', async () => {
    if (petWindow && !petWindow.isDestroyed()) {
        const pos = petWindow.getPosition();
        return { x: pos[0], y: pos[1] };
    }
    return { x: 0, y: 0 };
});

// ========== Chat Bubble ==========

ipcMain.handle('show-pet-chat', async (event, message, autoCloseTime = 8000) => {
    try {
        if (!petWindow || petWindow.isDestroyed()) return { success: false, error: 'no pet window' };

        // Close existing bubble
        if (chatBubbleWindow && !chatBubbleWindow.isDestroyed()) {
            chatBubbleWindow.close();
            chatBubbleWindow = null;
        }

        const petBounds = petWindow.getBounds();

        chatBubbleWindow = new BrowserWindow({
            width: 250, height: 80,
            x: petBounds.x + (petBounds.width - 250) / 2,
            y: petBounds.y - 80 + petBounds.height * 0.25,
            frame: false, transparent: true, alwaysOnTop: true,
            resizable: true, minimizable: false, maximizable: false,
            fullscreenable: false, skipTaskbar: true, focusable: false,
            show: false,
            webPreferences: {
                nodeIntegration: false,
                contextIsolation: true,
                preload: path.join(__dirname, 'preload.js')
            }
        });
        chatBubbleWindow.setAlwaysOnTop(true, 'screen-saver');
        chatBubbleWindow.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true });
        await chatBubbleWindow.loadFile('pet-chat-bubble.html');

        setTimeout(() => {
            if (chatBubbleWindow && !chatBubbleWindow.isDestroyed()) {
                chatBubbleWindow.webContents.send('chat-bubble-message', { message, autoCloseTime });
            }
        }, 500);

        chatBubbleWindow.on('closed', () => { chatBubbleWindow = null; });
        return { success: true };
    } catch (error) {
        return { success: false, error: error.message };
    }
});

ipcMain.handle('close-chat-bubble', async () => {
    try {
        if (chatBubbleWindow && !chatBubbleWindow.isDestroyed()) chatBubbleWindow.close();
        return { success: true };
    } catch (error) {
        return { success: false, error: error.message };
    }
});

ipcMain.handle('resize-chat-bubble', async (event, width, height) => {
    try {
        if (chatBubbleWindow && !chatBubbleWindow.isDestroyed() && petWindow && !petWindow.isDestroyed()) {
            const petBounds = petWindow.getBounds();
            chatBubbleWindow.setBounds({
                x: Math.round(petBounds.x + (petBounds.width - width) / 2),
                y: Math.round(petBounds.y - height + petBounds.height * 0.25),
                width: width, height: height
            });
            if (!chatBubbleWindow.isVisible()) {
                chatBubbleWindow.showInactive();
            }
        }
        return { success: true };
    } catch (error) {
        return { success: false, error: error.message };
    }
});

// ========== Screen Capture & Window Detection ==========

ipcMain.handle('get-screen-capture', async () => {
    try {
        const sources = await desktopCapturer.getSources({
            types: ['screen'], thumbnailSize: { width: 640, height: 640 }
        });
        if (sources.length > 0) {
            return sources[0].thumbnail.toJPEG(30).toString('base64');
        }
        return null;
    } catch (error) {
        console.error('Screen capture failed:', error);
        return null;
    }
});

ipcMain.handle('get-active-window', async () => {
    try {
        const activeWin = (await import('active-win')).default;
        const result = await activeWin();
        if (result) {
            return { success: true, data: result };
        }
        return { success: false, error: 'no active window' };
    } catch (error) {
        return { success: false, error: error.message };
    }
});

// ========== Utility ==========

ipcMain.handle('load-config', async () => {
    return loadConfigFile();
});

ipcMain.handle('save-config', async (event, data) => {
    return saveConfigFile(data);
});

ipcMain.handle('get-cursor-position', async () => {
    const { screen } = require('electron');
    return screen.getCursorScreenPoint();
});

ipcMain.handle('show-pet-context-menu', async () => {
    if (!petWindow || petWindow.isDestroyed()) return;
    const sizes = [200, 300, 400, 500];
    const template = [
        { label: '大小', submenu: sizes.map(s => ({
            label: `${s}x${s}`,
            click: () => {
                petWindow.setSize(s, s);
                petWindow.webContents.send('size-changed', s);
            }
        }))},
        { type: 'separator' },
        { label: '设置', click: () => {
            if (settingsWindow && !settingsWindow.isDestroyed()) {
                settingsWindow.show(); settingsWindow.focus();
            } else { createSettingsWindow(); }
        }},
        { label: '关闭', click: () => { if (petWindow && !petWindow.isDestroyed()) petWindow.close(); }}
    ];
    Menu.buildFromTemplate(template).popup({ window: petWindow });
});

ipcMain.handle('get-gender-term', async () => {
    return { success: true, term: '你' };
});

ipcMain.handle('open-dev-tools', async () => {
    if (petWindow && !petWindow.isDestroyed()) petWindow.webContents.openDevTools();
    return { success: true };
});

ipcMain.handle('get-app-path', async () => {
    return app.getAppPath();
});

// ========== Prompt Management ==========
const promptPath = path.join(__dirname, 'assets', 'prompts', 'sister.json');
const promptDefaultPath = path.join(__dirname, 'assets', 'prompts', 'sister.default.json');

ipcMain.handle('load-prompt', async () => {
    try {
        const data = JSON.parse(fs.readFileSync(promptPath, 'utf-8'));
        return { success: true, data: data.data || data };
    } catch (e) {
        return { success: false, error: e.message };
    }
});

ipcMain.handle('save-prompt', async (event, promptData) => {
    try {
        const json = { data: promptData };
        fs.writeFileSync(promptPath, JSON.stringify(json, null, 2), 'utf-8');
        return { success: true };
    } catch (e) {
        return { success: false, error: e.message };
    }
});

ipcMain.handle('reset-prompt', async () => {
    try {
        const defaultData = fs.readFileSync(promptDefaultPath, 'utf-8');
        fs.writeFileSync(promptPath, defaultData, 'utf-8');
        const parsed = JSON.parse(defaultData);
        return { success: true, data: parsed.data || parsed };
    } catch (e) {
        return { success: false, error: e.message };
    }
});

ipcMain.handle('show-settings', async () => {
    if (settingsWindow && !settingsWindow.isDestroyed()) {
        settingsWindow.show();
        settingsWindow.focus();
    } else {
        createSettingsWindow();
    }
    return { success: true };
});

// ========== Emotion System ==========

ipcMain.handle('trigger-expression', async (event, expressionName) => {
    try {
        if (petWindow && !petWindow.isDestroyed()) {
            petWindow.webContents.send('play-expression', expressionName);
            return { success: true };
        }
        return { success: false, error: 'no pet window' };
    } catch (error) {
        return { success: false, error: error.message };
    }
});

ipcMain.handle('revert-expression', async () => {
    try {
        if (petWindow && !petWindow.isDestroyed()) {
            petWindow.webContents.send('revert-expression');
            return { success: true };
        }
        return { success: false, error: 'no pet window' };
    } catch (error) {
        return { success: false, error: error.message };
    }
});

ipcMain.handle('report-hover-state', async (event, isHovering) => {
    try {
        if (settingsWindow && !settingsWindow.isDestroyed()) {
            settingsWindow.webContents.send('pet-hover-state', isHovering);
            return { success: true };
        }
        return { success: false, error: 'no settings window' };
    } catch (error) {
        return { success: false, error: error.message };
    }
});
