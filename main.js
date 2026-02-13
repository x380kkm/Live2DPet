const { app, BrowserWindow, ipcMain, desktopCapturer, Menu, dialog } = require('electron');
const path = require('path');
const fs = require('fs');
const { createPathUtils } = require('./src/utils/path-utils');
const { TTSService } = require('./src/core/tts-service');
const { TranslationService } = require('./src/core/translation-service');

let petWindow = null;
let chatBubbleWindow = null;
let settingsWindow = null;
let characterData = { isLive2DActive: true, live2dModelPath: null };
let pathUtils = null;
let ttsService = null;
let translationService = null;

// ========== Config Persistence ==========

const CURRENT_CONFIG_VERSION = 1;

function getDefaultModelConfig() {
    return {
        type: 'none',
        folderPath: null,
        modelJsonFile: null,
        copyToUserData: true,
        userDataModelPath: null,
        staticImagePath: null,
        bottomAlignOffset: 0.5,
        gifExpressions: {},
        paramMapping: {
            angleX: null, angleY: null, angleZ: null,
            bodyAngleX: null, eyeBallX: null, eyeBallY: null
        },
        hasExpressions: false,
        expressions: [],
        expressionDurations: {},
        defaultExpressionDuration: 5000,
        canvasYRatio: 0.60
    };
}

function getDefaultConfig() {
    return {
        configVersion: CURRENT_CONFIG_VERSION,
        apiKey: '',
        baseURL: 'https://openrouter.ai/api/v1',
        modelName: 'x-ai/grok-4.1-fast',
        interval: 10,
        emotionFrequency: 30,
        enabledEmotions: [],
        model: getDefaultModelConfig(),
        bubble: { frameImagePath: null },
        appIcon: null
    };
}

/**
 * Migrate old config (no configVersion) to current schema.
 * Old configs had hardcoded pink-devil model — strip that out.
 */
function migrateConfig(config) {
    if (config.configVersion >= CURRENT_CONFIG_VERSION) return config;

    // Pre-v1: no model section, hardcoded emotions
    if (!config.configVersion) {
        config.configVersion = CURRENT_CONFIG_VERSION;
        if (!config.model) {
            config.model = getDefaultModelConfig();
        }
        if (!config.bubble) {
            config.bubble = { frameImagePath: null };
        }
        if (config.appIcon === undefined) {
            config.appIcon = null;
        }
        // Clear old hardcoded emotions — user must re-configure per model
        if (Array.isArray(config.enabledEmotions) && config.enabledEmotions.length > 0) {
            config.enabledEmotions = [];
        }
    }

    return config;
}

// ========== Config Persistence ==========

// In packaged app, __dirname is inside read-only asar — use userData for writes
const bundledConfigPath = path.join(__dirname, 'config.json');
const userConfigPath = app.isPackaged
    ? path.join(app.getPath('userData'), 'config.json')
    : path.join(__dirname, 'config.json');

function loadConfigFile() {
    try {
        let raw = {};
        // Prefer user config (writable location)
        if (fs.existsSync(userConfigPath)) {
            raw = JSON.parse(fs.readFileSync(userConfigPath, 'utf-8'));
        } else if (app.isPackaged && fs.existsSync(bundledConfigPath)) {
            raw = JSON.parse(fs.readFileSync(bundledConfigPath, 'utf-8'));
        }
        // Merge with defaults to fill any missing fields
        const defaults = getDefaultConfig();
        const merged = {
            ...defaults,
            ...raw,
            model: { ...defaults.model, ...(raw.model || {}), paramMapping: { ...defaults.model.paramMapping, ...((raw.model || {}).paramMapping || {}) } },
            bubble: { ...defaults.bubble, ...(raw.bubble || {}) },
            tts: { ...(defaults.tts || {}), ...(raw.tts || {}) }
        };
        // Environment variable overrides
        if (process.env.LIVE2DPET_API_KEY) merged.apiKey = process.env.LIVE2DPET_API_KEY;
        if (process.env.LIVE2DPET_BASE_URL) merged.baseURL = process.env.LIVE2DPET_BASE_URL;
        if (process.env.LIVE2DPET_MODEL) merged.modelName = process.env.LIVE2DPET_MODEL;
        return migrateConfig(merged);
    } catch (e) { console.warn('Failed to load config:', e.message); }
    return getDefaultConfig();
}

function saveConfigFile(data) {
    try {
        const existing = loadConfigFile();
        // Deep merge model and bubble sections
        const merged = { ...existing, ...data };
        if (data.model) {
            merged.model = { ...existing.model, ...data.model };
            if (data.model.paramMapping) {
                merged.model.paramMapping = { ...existing.model.paramMapping, ...data.model.paramMapping };
            }
        }
        if (data.bubble) {
            merged.bubble = { ...existing.bubble, ...data.bubble };
        }
        fs.writeFileSync(userConfigPath, JSON.stringify(merged, null, 2), 'utf-8');
        return true;
    } catch (e) { console.error('Failed to save config:', e.message); return false; }
}

// ========== App Lifecycle ==========

app.whenReady().then(() => {
    pathUtils = createPathUtils(app, path);

    // Create windows first, then init TTS in background
    ttsService = new TTSService();
    translationService = new TranslationService();
    createSettingsWindow();

    // Initialize TTS after windows are created (non-blocking)
    setImmediate(() => {
        const voicevoxDir = pathUtils.getVoicevoxPath();
        if (voicevoxDir && fs.existsSync(voicevoxDir)) {
            const config = loadConfigFile();
            const vvmFiles = config.tts?.vvmFiles || ['0.vvm', '8.vvm'];
            const gpuMode = config.tts?.gpuMode || false;
            const ok = ttsService.init(voicevoxDir, vvmFiles, { gpuMode });
            if (ok) {
                if (config.tts) ttsService.setConfig(config.tts);
                if (config.apiKey) {
                    translationService.configure({
                        apiKey: config.apiKey,
                        baseURL: config.baseURL || 'https://openrouter.ai/api/v1',
                        modelName: config.modelName || 'x-ai/grok-4.1-fast'
                    });
                }
            }
        } else {
            console.log('[TTS] voicevox_core not found, TTS disabled');
        }
    });
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

// ========== Character Card Management (UUID-based) ==========
const bundledPromptsDir = path.join(__dirname, 'assets', 'prompts');
const promptsDir = app.isPackaged
    ? path.join(app.getPath('userData'), 'prompts')
    : path.join(__dirname, 'assets', 'prompts');
const crypto = require('crypto');

// On first run in packaged mode, copy bundled prompts to userData
if (app.isPackaged && !fs.existsSync(promptsDir)) {
    fs.mkdirSync(promptsDir, { recursive: true });
    try {
        const files = fs.readdirSync(bundledPromptsDir);
        for (const f of files) {
            if (f.endsWith('.json')) {
                fs.copyFileSync(path.join(bundledPromptsDir, f), path.join(promptsDir, f));
            }
        }
    } catch (e) {
        console.error('[Prompts] Failed to copy bundled prompts:', e.message);
    }
}

function getCharacterPath(id) {
    return path.join(promptsDir, `${id}.json`);
}

function ensureDefaultCharacters() {
    const config = loadConfigFile();
    if (config.characters && config.characters.length > 0) return;
    // Migration: create defaults if no characters exist
    const defaults = [
        { id: 'c4f2fb6a-30df-4f7f-a7b7-d150a9313ab3' },
        { id: '41529ce1-c2ad-4e3d-bf4d-85f4472d5209' }
    ];
    saveConfigFile({
        characters: defaults,
        activeCharacterId: defaults[1].id
    });
}

function readCardName(id) {
    try {
        const filePath = getCharacterPath(id);
        const data = JSON.parse(fs.readFileSync(filePath, 'utf-8'));
        const d = data.data || data;
        return d.cardName || d.name || id;
    } catch { return id; }
}

ipcMain.handle('list-characters', async () => {
    ensureDefaultCharacters();
    const config = loadConfigFile();
    const characters = (config.characters || []).map(c => ({
        id: c.id,
        name: readCardName(c.id)
    }));
    return {
        characters,
        activeCharacterId: config.activeCharacterId || ''
    };
});

ipcMain.handle('load-prompt', async (event, id) => {
    try {
        if (!id) {
            const config = loadConfigFile();
            id = config.activeCharacterId;
        }
        const filePath = getCharacterPath(id);
        if (!fs.existsSync(filePath)) return { success: false, error: 'not found' };
        const data = JSON.parse(fs.readFileSync(filePath, 'utf-8'));
        return { success: true, data: data.data || data, id };
    } catch (e) {
        return { success: false, error: e.message };
    }
});

ipcMain.handle('save-prompt', async (event, id, promptData) => {
    try {
        const json = { data: promptData };
        fs.writeFileSync(getCharacterPath(id), JSON.stringify(json, null, 2), 'utf-8');
        return { success: true };
    } catch (e) {
        return { success: false, error: e.message };
    }
});

ipcMain.handle('create-character', async (event, name) => {
    try {
        const id = crypto.randomUUID();
        const cardName = name || '新角色';
        const blank = {
            data: {
                cardName,
                name: cardName,
                userIdentity: '',
                userTerm: '你',
                description: '',
                personality: '',
                scenario: '',
                rules: ''
            }
        };
        fs.writeFileSync(getCharacterPath(id), JSON.stringify(blank, null, 2), 'utf-8');
        const config = loadConfigFile();
        const characters = [...(config.characters || []), { id }];
        saveConfigFile({ characters });
        return { success: true, id, name: cardName };
    } catch (e) {
        return { success: false, error: e.message };
    }
});

ipcMain.handle('delete-character', async (event, id) => {
    try {
        const config = loadConfigFile();
        const characters = config.characters || [];
        if (characters.length <= 1) return { success: false, error: 'cannot delete last character' };
        const filtered = characters.filter(c => c.id !== id);
        const update = { characters: filtered };
        if (config.activeCharacterId === id) {
            update.activeCharacterId = filtered[0].id;
        }
        saveConfigFile(update);
        const filePath = getCharacterPath(id);
        if (fs.existsSync(filePath)) fs.unlinkSync(filePath);
        return { success: true, newActiveId: update.activeCharacterId || config.activeCharacterId };
    } catch (e) {
        return { success: false, error: e.message };
    }
});

ipcMain.handle('rename-character', async (event, id, newName) => {
    try {
        const config = loadConfigFile();
        const characters = (config.characters || []).map(c =>
            c.id === id ? { ...c, name: newName } : c
        );
        saveConfigFile({ characters });
        return { success: true };
    } catch (e) {
        return { success: false, error: e.message };
    }
});

ipcMain.handle('set-active-character', async (event, id) => {
    try {
        saveConfigFile({ activeCharacterId: id });
        return { success: true };
    } catch (e) {
        return { success: false, error: e.message };
    }
});

ipcMain.handle('reset-prompt', async (event, id) => {
    // No-op for now — no per-character defaults stored
    return { success: false, error: 'no default available' };
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
        console.log(`[Main] trigger-expression: "${expressionName}", petWindow: ${!!petWindow}`);
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
        console.log('[Main] revert-expression');
        if (petWindow && !petWindow.isDestroyed()) {
            petWindow.webContents.send('revert-expression');
            return { success: true };
        }
        return { success: false, error: 'no pet window' };
    } catch (error) {
        return { success: false, error: error.message };
    }
});

ipcMain.handle('trigger-motion', async (event, group, index) => {
    try {
        console.log(`[Main] trigger-motion: group="${group}", index=${index}, petWindow: ${!!petWindow}`);
        if (petWindow && !petWindow.isDestroyed()) {
            petWindow.webContents.send('play-motion', group, index);
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

// ========== TTS ==========

ipcMain.handle('tts-synthesize', async (event, text) => {
    try {
        if (!ttsService || !ttsService.isAvailable()) {
            return { success: false, error: 'TTS not available' };
        }
        // Translate Chinese → Japanese
        let jaText = text;
        if (translationService && translationService.isConfigured()) {
            jaText = await translationService.translate(text);
        }
        console.log(`[TTS] CN: ${text}`);
        console.log(`[TTS] JA: ${jaText}`);
        // Synthesize
        const wavBuf = ttsService.synthesize(jaText);
        if (!wavBuf) return { success: false, error: 'synthesis failed' };
        return { success: true, wav: wavBuf.toString('base64'), jaText };
    } catch (error) {
        return { success: false, error: error.message };
    }
});

ipcMain.handle('tts-get-status', async () => {
    return {
        initialized: ttsService?.initialized || false,
        available: ttsService?.isAvailable() || false,
        degraded: ttsService?.degraded || false,
        degradedAt: ttsService?.degradedAt || 0,
        retryInterval: ttsService?.retryInterval || 60000,
        styleId: ttsService?.styleId || 0,
        gpuMode: ttsService?.isGpu || false,
        translationConfigured: translationService?.isConfigured() || false
    };
});

ipcMain.handle('tts-restart', async () => {
    try {
        if (ttsService) ttsService.destroy();
        const voicevoxDir = pathUtils.getVoicevoxPath();
        if (!voicevoxDir || !fs.existsSync(voicevoxDir)) {
            return { success: false, error: 'voicevox_core not found' };
        }
        const config = loadConfigFile();
        const vvmFiles = config.tts?.vvmFiles || ['0.vvm', '8.vvm'];
        const gpuMode = config.tts?.gpuMode || false;
        const ok = ttsService.init(voicevoxDir, vvmFiles, { gpuMode });
        if (ok && config.tts) ttsService.setConfig(config.tts);
        return { success: ok };
    } catch (error) {
        return { success: false, error: error.message };
    }
});

ipcMain.handle('tts-get-metas', async () => {
    if (!ttsService) return [];
    return ttsService.getMetas();
});

ipcMain.handle('tts-get-available-vvms', async () => {
    if (!ttsService || !pathUtils) return [];
    return ttsService.getAvailableVvms(pathUtils.getVoicevoxPath());
});

ipcMain.handle('download-vvm', async (event, filename) => {
    if (!pathUtils) return { success: false, error: 'not ready' };
    const modelsDir = path.join(pathUtils.getVoicevoxPath(), 'models');
    if (!fs.existsSync(modelsDir)) fs.mkdirSync(modelsDir, { recursive: true });
    const target = path.join(modelsDir, filename);
    if (fs.existsSync(target)) return { success: true, message: 'already exists' };
    try {
        const { execFile } = require('child_process');
        const url = `https://github.com/VOICEVOX/voicevox_vvm/releases/download/0.16.3/${filename}`;
        await new Promise((resolve, reject) => {
            execFile('curl', ['-L', '-o', target, url],
                { timeout: 120000 }, (err, stdout, stderr) => {
                    if (err) reject(new Error(stderr || err.message));
                    else resolve(stdout);
                });
        });
        console.log(`[VVM] Downloaded: ${filename}`);
        return { success: true };
    } catch (e) {
        console.error(`[VVM] Download failed: ${e.message}`);
        if (fs.existsSync(target)) fs.unlinkSync(target); // cleanup partial
        return { success: false, error: e.message };
    }
});

// One-click VOICEVOX setup
ipcMain.handle('setup-voicevox', async (event) => {
    if (!pathUtils) return { success: false, error: 'not ready' };
    const { execFile } = require('child_process');
    const baseDir = pathUtils.getVoicevoxPath();
    const send = (msg) => {
        console.log(`[VOICEVOX Setup] ${msg}`);
        try { event.sender.send('voicevox-setup-progress', msg); } catch {}
    };

    const run = (cmd, args, opts) => new Promise((resolve, reject) => {
        execFile(cmd, args, { timeout: 300000, ...opts }, (err, stdout, stderr) => {
            if (err) reject(new Error(stderr || err.message));
            else resolve(stdout);
        });
    });

    try {
        // Ensure directories
        const modelsDir = path.join(baseDir, 'models');
        const cApiDir = path.join(baseDir, 'c_api');
        fs.mkdirSync(modelsDir, { recursive: true });
        fs.mkdirSync(cApiDir, { recursive: true });

        // 1. Core DLL
        const coreDll = path.join(cApiDir, 'voicevox_core-windows-x64-0.16.3', 'lib', 'voicevox_core.dll');
        if (!fs.existsSync(coreDll)) {
            send('下载 voicevox_core...');
            const coreZip = path.join(baseDir, 'voicevox_core-windows-x64-0.16.3.zip');
            await run('curl', ['-L', '-o', coreZip,
                'https://github.com/VOICEVOX/voicevox_core/releases/download/0.16.3/voicevox_core-windows-x64-0.16.3.zip']);
            send('解压 voicevox_core...');
            await run('powershell', ['-Command',
                `Expand-Archive -Path "${path.join(baseDir, 'voicevox_core-windows-x64-0.16.3.zip')}" -DestinationPath "${cApiDir}" -Force`]);
            fs.unlinkSync(path.join(baseDir, 'voicevox_core-windows-x64-0.16.3.zip'));
        } else {
            send('voicevox_core 已存在');
        }

        // 2. ONNX Runtime (CPU)
        const onnxDll = path.join(baseDir, 'voicevox_onnxruntime-win-x64-1.17.3', 'lib', 'voicevox_onnxruntime.dll');
        if (!fs.existsSync(onnxDll)) {
            send('下载 ONNX Runtime...');
            const onnxTgz = path.join(baseDir, 'voicevox_onnxruntime-win-x64-1.17.3.tgz');
            await run('curl', ['-L', '-o', onnxTgz,
                'https://github.com/VOICEVOX/onnxruntime-builder/releases/download/voicevox_onnxruntime-1.17.3/voicevox_onnxruntime-win-x64-1.17.3.tgz']);
            send('解压 ONNX Runtime...');
            await run('tar', ['xzf', onnxTgz, '-C', baseDir]);
            fs.unlinkSync(onnxTgz);
        } else {
            send('ONNX Runtime 已存在');
        }

        // 3. Open JTalk dictionary
        const dictDir = path.join(baseDir, 'open_jtalk_dic_utf_8-1.11');
        if (!fs.existsSync(dictDir)) {
            send('下载 Open JTalk 辞書...');
            const dictTgz = path.join(baseDir, 'dict.tar.gz');
            await run('curl', ['-L', '-o', dictTgz,
                'https://sourceforge.net/projects/open-jtalk/files/Dictionary/open_jtalk_dic-1.11/open_jtalk_dic_utf_8-1.11.tar.gz/download'],
                { timeout: 300000 });
            send('解压 Open JTalk 辞書...');
            await run('tar', ['xzf', dictTgz, '-C', baseDir]);
            fs.unlinkSync(dictTgz);
        } else {
            send('Open JTalk 辞書 已存在');
        }

        // 4. Default VVM (0.vvm)
        const vvm0 = path.join(modelsDir, '0.vvm');
        if (!fs.existsSync(vvm0)) {
            send('下载 0.vvm...');
            await run('curl', ['-L', '-o', vvm0,
                'https://github.com/VOICEVOX/voicevox_vvm/releases/download/0.16.3/0.vvm']);
        } else {
            send('0.vvm 已存在');
        }

        send('安装完成!');
        return { success: true, path: baseDir };
    } catch (e) {
        send('安装失败: ' + e.message);
        return { success: false, error: e.message };
    }
});

ipcMain.handle('tts-set-config', async (event, config) => {
    if (ttsService && config) {
        ttsService.setConfig(config);
        // Persist (merge, don't overwrite)
        const fileConfig = loadConfigFile();
        fileConfig.tts = Object.assign(fileConfig.tts || {}, {
            styleId: ttsService.styleId,
            speedScale: ttsService.speedScale,
            pitchScale: ttsService.pitchScale,
            volumeScale: ttsService.volumeScale
        });
        saveConfigFile(fileConfig);
    }
    return { success: true };
});

// ========== Default Audio ==========

ipcMain.handle('generate-default-audio', async (event, phrases, styleId) => {
    try {
        if (!ttsService || !ttsService.isAvailable()) {
            return { success: false, error: 'TTS not available' };
        }
        const audioDir = path.join(app.getPath('userData'), 'default-audio');
        if (!fs.existsSync(audioDir)) fs.mkdirSync(audioDir, { recursive: true });
        // Clear old files
        for (const f of fs.readdirSync(audioDir)) {
            if (f.endsWith('.wav')) fs.unlinkSync(path.join(audioDir, f));
        }
        const oldStyleId = ttsService.styleId;
        if (styleId !== undefined) ttsService.styleId = styleId;
        const results = [];
        for (let i = 0; i < phrases.length; i++) {
            const phrase = phrases[i];
            try {
                const wavBuf = ttsService.synthesize(phrase);
                if (wavBuf) {
                    const filePath = path.join(audioDir, `default_${i}.wav`);
                    fs.writeFileSync(filePath, wavBuf);
                    results.push({ phrase, file: `default_${i}.wav`, success: true });
                } else {
                    results.push({ phrase, success: false });
                }
            } catch (e) {
                results.push({ phrase, success: false, error: e.message });
            }
        }
        ttsService.styleId = oldStyleId;
        // Save phrases to config
        const config = loadConfigFile();
        config.tts = config.tts || {};
        config.tts.defaultPhrases = phrases;
        saveConfigFile(config);
        return { success: true, results };
    } catch (error) {
        return { success: false, error: error.message };
    }
});

ipcMain.handle('load-default-audio', async () => {
    try {
        const audioDir = path.join(app.getPath('userData'), 'default-audio');
        if (!fs.existsSync(audioDir)) return { success: true, files: [] };
        const files = fs.readdirSync(audioDir)
            .filter(f => f.endsWith('.wav'))
            .map(f => {
                const data = fs.readFileSync(path.join(audioDir, f));
                return { name: f, base64: data.toString('base64') };
            });
        return { success: true, files };
    } catch (error) {
        return { success: false, error: error.message, files: [] };
    }
});

// ========== Model Import & Scanning ==========

// Fuzzy matching dictionary for parameter auto-mapping
const PARAM_FUZZY_MAP = {
    angleX:     ['ParamAngleX', 'ParamX', 'Angle_X', 'PARAM_ANGLE_X', 'AngleX'],
    angleY:     ['ParamAngleY', 'ParamY', 'Angle_Y', 'PARAM_ANGLE_Y', 'AngleY'],
    angleZ:     ['ParamAngleZ', 'ParamZ', 'Angle_Z', 'PARAM_ANGLE_Z', 'AngleZ'],
    bodyAngleX: ['ParamBodyAngleX', 'BodyAngleX', 'PARAM_BODY_ANGLE_X', 'ParamBodyX'],
    eyeBallX:   ['ParamEyeBallX', 'EyeBallX', 'PARAM_EYE_BALL_X', 'ParamEyeX'],
    eyeBallY:   ['ParamEyeBallY', 'EyeBallY', 'PARAM_EYE_BALL_Y', 'ParamEyeY']
};

function suggestParamMapping(parameterIds) {
    const suggested = {};
    for (const [key, candidates] of Object.entries(PARAM_FUZZY_MAP)) {
        const match = candidates.find(c =>
            parameterIds.some(p => p.toLowerCase() === c.toLowerCase())
        );
        if (match) {
            // Return the actual parameter ID from the model (case-preserved)
            suggested[key] = parameterIds.find(p => p.toLowerCase() === match.toLowerCase());
        } else {
            suggested[key] = null;
        }
    }
    return suggested;
}

ipcMain.handle('select-model-folder', async () => {
    try {
        const result = await dialog.showOpenDialog(settingsWindow || BrowserWindow.getFocusedWindow(), {
            properties: ['openDirectory'],
            title: '选择 Live2D 模型文件夹'
        });
        if (result.canceled || !result.filePaths.length) {
            return { success: false, error: 'cancelled' };
        }
        const folderPath = result.filePaths[0];
        // Scan for .model3.json files (also check one level of subdirectories)
        let files = fs.readdirSync(folderPath);
        let modelFiles = files.filter(f => f.endsWith('.model3.json'));
        let actualFolder = folderPath;
        if (modelFiles.length === 0) {
            // Check subdirectories (e.g. runtime/)
            for (const sub of files) {
                const subPath = path.join(folderPath, sub);
                try {
                    if (fs.statSync(subPath).isDirectory()) {
                        const subFiles = fs.readdirSync(subPath);
                        const subModels = subFiles.filter(f => f.endsWith('.model3.json'));
                        if (subModels.length > 0) {
                            modelFiles = subModels;
                            actualFolder = subPath;
                            break;
                        }
                    }
                } catch {}
            }
        }
        if (modelFiles.length === 0) {
            return { success: false, error: '该文件夹中未找到 .model3.json 文件' };
        }
        return { success: true, folderPath: actualFolder, modelFiles };
    } catch (error) {
        return { success: false, error: error.message };
    }
});

ipcMain.handle('scan-model-info', async (event, folderPath, modelJsonFile) => {
    try {
        const modelJsonPath = path.join(folderPath, modelJsonFile);
        if (!fs.existsSync(modelJsonPath)) {
            return { success: false, error: 'model3.json 不存在' };
        }
        const modelJson = JSON.parse(fs.readFileSync(modelJsonPath, 'utf-8'));

        // Extract parameter IDs from model3.json
        let parameterIds = [];
        // Try to get parameters from Groups
        if (modelJson.Groups) {
            modelJson.Groups.forEach(g => {
                if (g.Ids) parameterIds.push(...g.Ids);
            });
        }
        // Also read from .cdi3.json (DisplayInfo) for complete parameter list
        if (modelJson.FileReferences) {
            const cdiFile = modelJson.FileReferences.DisplayInfo;
            if (cdiFile) {
                const cdiPath = path.join(folderPath, cdiFile);
                try {
                    if (fs.existsSync(cdiPath)) {
                        const cdiJson = JSON.parse(fs.readFileSync(cdiPath, 'utf-8'));
                        if (cdiJson.Parameters && Array.isArray(cdiJson.Parameters)) {
                            parameterIds.push(...cdiJson.Parameters.map(p => p.Id));
                        }
                    }
                } catch {}
            }
        }
        // Deduplicate
        parameterIds = [...new Set(parameterIds)];

        // Try to get from HitAreas
        const hitAreas = modelJson.HitAreas || [];

        // Extract expressions from model3.json
        let expressions = [];
        if (modelJson.FileReferences && modelJson.FileReferences.Expressions) {
            expressions = modelJson.FileReferences.Expressions.map(e => ({
                name: e.Name,
                file: e.File
            }));
        }
        // If no expressions declared, scan folder for .exp3.json files
        if (expressions.length === 0) {
            try {
                const folderFiles = fs.readdirSync(folderPath);
                const expFiles = folderFiles.filter(f => f.endsWith('.exp3.json'));
                expressions = expFiles.map(f => ({
                    name: f.replace('.exp3.json', ''),
                    file: f
                }));
            } catch {}
        }

        // Extract motions from model3.json — full structure {group: [{File}]}
        let motions = {};
        if (modelJson.FileReferences && modelJson.FileReferences.Motions) {
            const raw = modelJson.FileReferences.Motions;
            for (const [group, entries] of Object.entries(raw)) {
                motions[group] = (entries || []).map(e => ({ file: e.File }));
            }
        }
        // If no motions declared, scan folder for .motion3.json files → "Default" group
        if (Object.keys(motions).length === 0) {
            try {
                const folderFiles = fs.readdirSync(folderPath);
                const motionFiles = folderFiles.filter(f => f.endsWith('.motion3.json'));
                if (motionFiles.length > 0) {
                    motions['Default'] = motionFiles.map(f => ({ file: f }));
                }
            } catch {}
        }

        // Validate moc3 file exists
        let mocValid = false;
        if (modelJson.FileReferences && modelJson.FileReferences.Moc) {
            const mocPath = path.join(folderPath, modelJson.FileReferences.Moc);
            mocValid = fs.existsSync(mocPath);
        }

        // Validate textures
        let texturesValid = false;
        if (modelJson.FileReferences && modelJson.FileReferences.Textures) {
            texturesValid = modelJson.FileReferences.Textures.every(t =>
                fs.existsSync(path.join(folderPath, t))
            );
        }

        const suggestedMapping = suggestParamMapping(parameterIds);

        return {
            success: true,
            modelName: modelJsonFile.replace('.model3.json', ''),
            parameterIds,
            suggestedMapping,
            expressions,
            motions,
            hitAreas,
            validation: { mocValid, texturesValid }
        };
    } catch (error) {
        return { success: false, error: error.message };
    }
});

ipcMain.handle('select-static-image', async () => {
    try {
        const result = await dialog.showOpenDialog(settingsWindow || BrowserWindow.getFocusedWindow(), {
            properties: ['openFile'],
            title: '选择静态图片或 GIF',
            filters: [{ name: '图片', extensions: ['png', 'jpg', 'jpeg', 'gif', 'webp', 'svg'] }]
        });
        if (result.canceled || !result.filePaths.length) {
            return { success: false, error: 'cancelled' };
        }
        return { success: true, filePath: result.filePaths[0] };
    } catch (error) {
        return { success: false, error: error.message };
    }
});

ipcMain.handle('select-image-folder', async () => {
    try {
        const result = await dialog.showOpenDialog(settingsWindow || BrowserWindow.getFocusedWindow(), {
            properties: ['openDirectory'],
            title: '选择图片文件夹'
        });
        if (result.canceled || !result.filePaths.length) {
            return { success: false, error: 'cancelled' };
        }
        return { success: true, folderPath: result.filePaths[0] };
    } catch (error) {
        return { success: false, error: error.message };
    }
});

ipcMain.handle('scan-image-folder', async (event, folderPath) => {
    try {
        const files = fs.readdirSync(folderPath);
        const imageExts = ['.png', '.jpg', '.jpeg', '.webp'];
        const images = files
            .filter(f => imageExts.includes(path.extname(f).toLowerCase()))
            .map(f => ({ filename: f, path: path.join(folderPath, f) }));
        return { success: true, images };
    } catch (error) {
        return { success: false, error: error.message };
    }
});

ipcMain.handle('set-talking-state', async (event, isTalking) => {
    if (petWindow && !petWindow.isDestroyed()) {
        petWindow.webContents.send('talking-state-changed', isTalking);
    }
    return { success: true };
});

ipcMain.handle('select-bubble-image', async () => {
    try {
        const result = await dialog.showOpenDialog(settingsWindow || BrowserWindow.getFocusedWindow(), {
            properties: ['openFile'],
            title: '选择气泡框图片',
            filters: [{ name: '图片', extensions: ['png', 'jpg', 'jpeg', 'svg'] }]
        });
        if (result.canceled || !result.filePaths.length) {
            return { success: false, error: 'cancelled' };
        }
        return { success: true, filePath: result.filePaths[0] };
    } catch (error) {
        return { success: false, error: error.message };
    }
});

ipcMain.handle('select-app-icon', async () => {
    try {
        const result = await dialog.showOpenDialog(settingsWindow || BrowserWindow.getFocusedWindow(), {
            properties: ['openFile'],
            title: '选择应用图标',
            filters: [{ name: '图标', extensions: ['png', 'ico', 'jpg'] }]
        });
        if (result.canceled || !result.filePaths.length) {
            return { success: false, error: 'cancelled' };
        }
        // Copy to userData
        const srcPath = result.filePaths[0];
        const ext = path.extname(srcPath);
        const destPath = path.join(app.getPath('userData'), 'app-icon' + ext);
        fs.copyFileSync(srcPath, destPath);
        return { success: true, iconPath: destPath };
    } catch (error) {
        return { success: false, error: error.message };
    }
});

ipcMain.handle('copy-model-to-userdata', async (event, folderPath, modelName) => {
    try {
        // Use model name if provided, otherwise folder basename
        const dirName = modelName || path.basename(folderPath);
        const destDir = path.join(app.getPath('userData'), 'models', dirName);
        // Recursive copy
        fs.cpSync(folderPath, destDir, { recursive: true });
        const relPath = path.join('models', dirName);
        return { success: true, userDataModelPath: relPath, absolutePath: destDir };
    } catch (error) {
        return { success: false, error: error.message };
    }
});

ipcMain.handle('validate-model-paths', async () => {
    try {
        const config = loadConfigFile();
        const model = config.model || {};
        if (model.type === 'none') return { success: true, valid: true, type: 'none' };

        if (model.type === 'live2d') {
            let modelDir;
            if (model.userDataModelPath) {
                modelDir = path.join(app.getPath('userData'), model.userDataModelPath);
            } else {
                modelDir = model.folderPath;
            }
            if (!modelDir || !fs.existsSync(modelDir)) {
                return { success: true, valid: false, error: '模型文件夹不存在' };
            }
            if (model.modelJsonFile) {
                const jsonPath = path.join(modelDir, model.modelJsonFile);
                if (!fs.existsSync(jsonPath)) {
                    return { success: true, valid: false, error: 'model3.json 不存在' };
                }
                // Validate it parses
                try { JSON.parse(fs.readFileSync(jsonPath, 'utf-8')); }
                catch { return { success: true, valid: false, error: 'model3.json 解析失败' }; }
            }
            return { success: true, valid: true, type: 'live2d', modelDir };
        }

        if (model.type === 'image') {
            if (!model.staticImagePath || !fs.existsSync(model.staticImagePath)) {
                return { success: true, valid: false, error: '图片文件不存在' };
            }
            return { success: true, valid: true, type: 'image' };
        }

        return { success: true, valid: true, type: model.type };
    } catch (error) {
        return { success: false, error: error.message };
    }
});

ipcMain.handle('delete-profile', async (event, profileId) => {
    try {
        if (!profileId) return { success: false, error: 'no profile ID' };
        const profileDir = path.join(app.getPath('userData'), 'profiles', profileId);
        if (fs.existsSync(profileDir)) {
            fs.rmSync(profileDir, { recursive: true, force: true });
        }
        return { success: true };
    } catch (error) {
        return { success: false, error: error.message };
    }
});
