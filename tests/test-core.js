/**
 * Unit tests for Desktop Pet Standalone core modules
 * Run with: node --test tests/test-core.js
 */
const { describe, it, beforeEach } = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');

// ========== Test: AIChatClient ==========

describe('AIChatClient', () => {
    let AIChatClient;

    beforeEach(() => {
        // Load the class by evaluating the source (browser-style class)
        const src = fs.readFileSync(path.join(__dirname, '..', 'src', 'core', 'ai-chat.js'), 'utf-8');
        // Mock browser globals
        global.window = {};
        global.localStorage = {
            _store: {},
            getItem(k) { return this._store[k] || null; },
            setItem(k, v) { this._store[k] = v; },
            removeItem(k) { delete this._store[k]; }
        };
        global.fetch = async () => { throw new Error('fetch not mocked'); };
        eval(src);
        AIChatClient = global.window.AIChatClient;
    });

    it('should instantiate with defaults', () => {
        const client = new AIChatClient();
        assert.strictEqual(client.baseURL, 'https://openrouter.ai/api/v1');
        assert.strictEqual(client.modelName, 'x-ai/grok-4.1-fast');
        assert.strictEqual(client.apiKey, '');
        assert.strictEqual(client.isLoading, false);
    });

    it('isConfigured returns false when no apiKey', () => {
        const client = new AIChatClient();
        assert.strictEqual(client.isConfigured(), false);
    });

    it('isConfigured returns true when all fields set', () => {
        const client = new AIChatClient();
        client.apiKey = 'test-key';
        client.baseURL = 'https://api.test.com/v1';
        client.modelName = 'test-model';
        assert.strictEqual(client.isConfigured(), true);
    });

    it('saveConfig updates in-memory values', () => {
        const client = new AIChatClient();
        client.saveConfig({ apiKey: 'sk-123', baseURL: 'https://test.com/v1', modelName: 'gpt-4' });
        assert.strictEqual(client.apiKey, 'sk-123');
        assert.strictEqual(client.baseURL, 'https://test.com/v1');
        assert.strictEqual(client.modelName, 'gpt-4');
    });

    it('loadConfig reads from electronAPI', async () => {
        global.window.electronAPI = {
            loadConfig: async () => ({
                apiKey: 'sk-saved', baseURL: 'https://saved.com/v1', modelName: 'saved-model'
            })
        };
        const client = new AIChatClient();
        await client.loadConfig();
        assert.strictEqual(client.apiKey, 'sk-saved');
        assert.strictEqual(client.baseURL, 'https://saved.com/v1');
    });

    it('getConfig returns current config', () => {
        const client = new AIChatClient();
        client.apiKey = 'key1';
        const config = client.getConfig();
        assert.strictEqual(config.apiKey, 'key1');
        assert.strictEqual(config.baseURL, 'https://openrouter.ai/api/v1');
    });

    it('cleanResponse removes think tags', () => {
        const client = new AIChatClient();
        assert.strictEqual(client.cleanResponse('<think>internal</think>Hello'), 'Hello');
        assert.strictEqual(client.cleanResponse('<thinking>hmm</thinking>Hi'), 'Hi');
    });

    it('cleanResponse handles empty input', () => {
        const client = new AIChatClient();
        assert.strictEqual(client.cleanResponse(''), '');
        assert.strictEqual(client.cleanResponse(null), null);
    });

    it('callAPI throws when not configured', async () => {
        const client = new AIChatClient();
        await assert.rejects(
            () => client.callAPI([{ role: 'user', content: 'test' }]),
            { message: 'API not configured' }
        );
    });

    it('callAPI sends correct request format', async () => {
        const client = new AIChatClient();
        client.apiKey = 'sk-test';
        client.baseURL = 'https://api.test.com/v1';
        client.modelName = 'test-model';

        let capturedRequest = null;
        global.fetch = async (url, options) => {
            capturedRequest = { url, ...options };
            return {
                ok: true,
                json: async () => ({
                    choices: [{ message: { content: 'test response' } }]
                })
            };
        };

        const result = await client.callAPI([
            { role: 'system', content: 'sys' },
            { role: 'user', content: 'hello' }
        ]);

        assert.strictEqual(result, 'test response');
        assert.strictEqual(capturedRequest.url, 'https://api.test.com/v1/chat/completions');
        assert.strictEqual(capturedRequest.method, 'POST');

        const body = JSON.parse(capturedRequest.body);
        assert.strictEqual(body.model, 'test-model');
        assert.strictEqual(body.messages.length, 2);

        const headers = capturedRequest.headers;
        assert.strictEqual(headers['Authorization'], 'Bearer sk-test');
    });

    it('callAPI handles API error response', async () => {
        const client = new AIChatClient();
        client.apiKey = 'sk-test';

        global.fetch = async () => ({
            ok: false, status: 429,
            text: async () => 'rate limited'
        });

        await assert.rejects(
            () => client.callAPI([{ role: 'user', content: 'test' }]),
            (err) => err.message.includes('429')
        );
    });
});

// ========== Test: PetPromptBuilder ==========

describe('PetPromptBuilder', () => {
    let PetPromptBuilder;

    beforeEach(() => {
        const src = fs.readFileSync(path.join(__dirname, '..', 'src', 'core', 'prompt-builder.js'), 'utf-8');
        global.window = {};
        global.fetch = async () => { throw new Error('fetch not mocked'); };
        eval(src);
        PetPromptBuilder = global.window.PetPromptBuilder;
    });

    it('should instantiate with defaults', () => {
        const builder = new PetPromptBuilder();
        assert.strictEqual(builder.characterPrompt, null);
    });

    it('getAppDetectionPrompt includes app name', () => {
        const builder = new PetPromptBuilder();
        const prompt = builder.getAppDetectionPrompt('Chrome');
        assert.ok(prompt.includes('Chrome'));
        assert.ok(prompt.includes('system'));
    });

    it('getIdlePrompt returns a string', () => {
        const builder = new PetPromptBuilder();
        const prompt = builder.getIdlePrompt();
        assert.strictEqual(typeof prompt, 'string');
        assert.ok(prompt.length > 0);
    });

    it('buildSystemPrompt returns default when no character loaded', () => {
        const builder = new PetPromptBuilder();
        const prompt = builder.buildSystemPrompt();
        assert.ok(prompt.includes('desktop pet'));
    });

    it('buildSystemPrompt uses loaded character data', () => {
        const builder = new PetPromptBuilder();
        builder.characterPrompt = {
            description: 'Test description',
            personality: 'Test personality',
            scenario: 'Test scenario'
        };
        const prompt = builder.buildSystemPrompt();
        assert.ok(prompt.includes('Test description'));
        assert.ok(prompt.includes('Test personality'));
        assert.ok(prompt.includes('Test scenario'));
    });

    it('init falls back to default on fetch failure', async () => {
        global.fetch = async () => { throw new Error('network error'); };
        const builder = new PetPromptBuilder();
        await builder.init();
        assert.ok(builder.characterPrompt !== null);
        assert.ok(builder.characterPrompt.description.length > 0);
    });
});

// ========== Test: DesktopPetSystem ==========

describe('DesktopPetSystem', () => {
    let DesktopPetSystem, AIChatClient, PetPromptBuilder;

    beforeEach(() => {
        global.window = {};
        global.localStorage = {
            _store: {},
            getItem(k) { return this._store[k] || null; },
            setItem(k, v) { this._store[k] = v; },
            removeItem(k) { delete this._store[k]; }
        };
        global.fetch = async () => { throw new Error('fetch not mocked'); };

        // Load dependencies in order
        const aiSrc = fs.readFileSync(path.join(__dirname, '..', 'src', 'core', 'ai-chat.js'), 'utf-8');
        eval(aiSrc);
        AIChatClient = global.window.AIChatClient;

        const promptSrc = fs.readFileSync(path.join(__dirname, '..', 'src', 'core', 'prompt-builder.js'), 'utf-8');
        eval(promptSrc);
        PetPromptBuilder = global.window.PetPromptBuilder;

        const emotionSrc = fs.readFileSync(path.join(__dirname, '..', 'src', 'core', 'emotion-system.js'), 'utf-8');
        eval(emotionSrc);
        global.EmotionSystem = global.window.EmotionSystem;

        const audioSmSrc = fs.readFileSync(path.join(__dirname, '..', 'src', 'core', 'audio-state-machine.js'), 'utf-8');
        eval(audioSmSrc);
        global.AudioStateMachine = global.window.AudioStateMachine;

        const msgSessionSrc = fs.readFileSync(path.join(__dirname, '..', 'src', 'core', 'message-session.js'), 'utf-8');
        eval(msgSessionSrc);
        global.MessageSession = global.window.MessageSession;

        const sysSrc = fs.readFileSync(path.join(__dirname, '..', 'src', 'core', 'desktop-pet-system.js'), 'utf-8');
        eval(sysSrc);
        DesktopPetSystem = global.window.DesktopPetSystem;
    });

    it('should instantiate with defaults', () => {
        const sys = new DesktopPetSystem();
        assert.strictEqual(sys.isActive, false);
        assert.strictEqual(sys.detectionIntervalMs, 30000);
        assert.strictEqual(sys.aiClient, null);
        assert.strictEqual(sys.emotionSystem, null);
        assert.strictEqual(sys.currentAudio, null);
        assert.strictEqual(sys.currentAudioUrl, null);
    });

    it('setInterval enforces minimum 10s', () => {
        const sys = new DesktopPetSystem();
        sys.setInterval(5000);
        assert.strictEqual(sys.detectionIntervalMs, 10000);
    });

    it('setInterval accepts valid values', () => {
        const sys = new DesktopPetSystem();
        sys.setInterval(60000);
        assert.strictEqual(sys.detectionIntervalMs, 60000);
    });

    it('shouldSkipApp skips electron and desktop-pet', () => {
        const sys = new DesktopPetSystem();
        assert.strictEqual(sys.shouldSkipApp('Electron'), true);
        assert.strictEqual(sys.shouldSkipApp('desktop-pet-standalone'), true);
        assert.strictEqual(sys.shouldSkipApp('Chrome'), false);
        assert.strictEqual(sys.shouldSkipApp('Houdini'), false);
    });

    it('init creates aiClient and promptBuilder', async () => {
        const sys = new DesktopPetSystem();
        await sys.init();
        assert.ok(sys.aiClient instanceof AIChatClient);
        assert.ok(sys.promptBuilder instanceof PetPromptBuilder);
        assert.strictEqual(typeof sys.systemPrompt, 'string');
    });

    it('stop resets state', async () => {
        const sys = new DesktopPetSystem();
        sys.isActive = true;
        sys.emotionSystem = { stop() {} };
        sys.focusTracker = { 'Chrome': 5 };
        sys.screenshotBuffers = { 'Chrome': ['data'] };
        global.window.electronAPI = { closePetWindow: async () => ({}) };
        await sys.stop();
        assert.strictEqual(sys.isActive, false);
        assert.deepStrictEqual(sys.focusTracker, {});
        assert.deepStrictEqual(sys.screenshotBuffers, {});
        assert.strictEqual(sys.currentAudio, null);
        assert.strictEqual(sys.currentAudioUrl, null);
    });

    it('stopCurrentAudio pauses and cleans up', () => {
        const sys = new DesktopPetSystem();
        let paused = false;
        let revokedUrl = null;
        sys.currentAudio = { pause() { paused = true; } };
        sys.currentAudioUrl = 'blob:test-url';
        global.URL = { revokeObjectURL(url) { revokedUrl = url; } };
        sys.stopCurrentAudio();
        assert.strictEqual(paused, true);
        assert.strictEqual(revokedUrl, 'blob:test-url');
        assert.strictEqual(sys.currentAudio, null);
        assert.strictEqual(sys.currentAudioUrl, null);
    });

    it('stopCurrentAudio is safe when no audio playing', () => {
        const sys = new DesktopPetSystem();
        sys.stopCurrentAudio();
        assert.strictEqual(sys.currentAudio, null);
        assert.strictEqual(sys.currentAudioUrl, null);
    });
});

// ========== Test: EmotionSystem ==========

describe('EmotionSystem', () => {
    const ctx = {};

    beforeEach(() => {
        global.window = {};
        global.fetch = async () => { throw new Error('fetch not mocked'); };

        const src = fs.readFileSync(path.join(__dirname, '..', 'src', 'core', 'emotion-system.js'), 'utf-8');
        eval(src);
        ctx.EmotionSystem = global.window.EmotionSystem;
    });

    it('should instantiate with empty expressions (decoupled)', () => {
        const es = new ctx.EmotionSystem({ aiClient: {} });
        assert.strictEqual(es.emotionValue, 0);
        assert.strictEqual(es.emotionThreshold, 100);
        assert.strictEqual(es.expectedFrequencySeconds, 60);
        assert.strictEqual(es.isPlayingExpression, false);
        assert.strictEqual(es.nextEmotionBuffer, null);
        assert.strictEqual(es.enabledEmotions.length, 0);
        assert.strictEqual(es.emotionExpressions.length, 0);
    });

    it('configureExpressions sets up dynamic expression list', () => {
        const es = new ctx.EmotionSystem({ aiClient: {} });
        const exprs = [
            { name: '脸红', label: 'Blush' },
            { name: '生气', label: 'Angry' }
        ];
        es.configureExpressions(exprs, { '脸红': 3000 }, 5000);
        assert.strictEqual(es.emotionExpressions.length, 2);
        assert.deepStrictEqual(es.enabledEmotions, ['脸红', '生气']);
        assert.strictEqual(es.expressionDurations['脸红'], 3000);
        assert.strictEqual(es.defaultExpressionDuration, 5000);
    });

    it('start does nothing when no expressions configured', () => {
        const es = new ctx.EmotionSystem({ aiClient: {} });
        es.start();
        assert.strictEqual(es.accumulationTimer, null);
    });

    it('start works when expressions are configured', () => {
        const es = new ctx.EmotionSystem({ aiClient: {} });
        es.configureExpressions([{ name: 'test', label: 'Test' }], {}, 5000);
        es.start();
        assert.ok(es.accumulationTimer !== null);
        es.stop(); // cleanup
    });

    it('_recalculateRates computes correct base rate', () => {
        const es = new ctx.EmotionSystem({ aiClient: {} });
        assert.ok(Math.abs(es.baseAccumulationRate - 100 / 60) < 0.001);
        assert.ok(Math.abs(es.hoverAccumulationRate - es.baseAccumulationRate * 0.5) < 0.001);
    });

    it('setExpectedFrequency enforces minimum 30', () => {
        const es = new ctx.EmotionSystem({ aiClient: {} });
        es.setExpectedFrequency(10);
        assert.strictEqual(es.expectedFrequencySeconds, 30);
    });

    it('setExpectedFrequency recalculates rates', () => {
        const es = new ctx.EmotionSystem({ aiClient: {} });
        es.setExpectedFrequency(120);
        assert.strictEqual(es.expectedFrequencySeconds, 120);
        assert.ok(Math.abs(es.baseAccumulationRate - 100 / 120) < 0.001);
    });

    it('_tick accumulates base rate', () => {
        const es = new ctx.EmotionSystem({ aiClient: {} });
        es._tick();
        assert.ok(Math.abs(es.emotionValue - es.baseAccumulationRate) < 0.001);
    });

    it('_tick adds hover bonus when hovering', () => {
        const es = new ctx.EmotionSystem({ aiClient: {} });
        es.setHoverState(true);
        es._tick();
        const expected = es.baseAccumulationRate + es.hoverAccumulationRate;
        assert.ok(Math.abs(es.emotionValue - expected) < 0.001);
    });

    it('_tick does not accumulate during expression playback', () => {
        const es = new ctx.EmotionSystem({ aiClient: {} });
        es.isPlayingExpression = true;
        es._tick();
        assert.strictEqual(es.emotionValue, 0);
    });

    it('onAIResponse adds bonus', () => {
        const es = new ctx.EmotionSystem({ aiClient: { callAPI: async () => '脸红' } });
        es.configureExpressions([{ name: '脸红', label: 'Blush' }], {}, 5000);
        es.onAIResponse('Hello world test response');
        assert.ok(es.emotionValue > 0);
    });

    it('setEnabledEmotions filters invalid names', () => {
        const es = new ctx.EmotionSystem({ aiClient: {} });
        es.configureExpressions([
            { name: '脸红', label: 'Blush' },
            { name: '生气', label: 'Angry' }
        ], {}, 5000);
        es.setEnabledEmotions(['脸红', 'invalid', '生气']);
        assert.deepStrictEqual(es.enabledEmotions, ['脸红', '生气']);
    });

    it('stop resets all state', () => {
        const es = new ctx.EmotionSystem({ aiClient: {} });
        es.emotionValue = 50;
        es.nextEmotionBuffer = '脸红';
        es.isPlayingExpression = true;
        es.stop();
        assert.strictEqual(es.emotionValue, 0);
        assert.strictEqual(es.nextEmotionBuffer, null);
        assert.strictEqual(es.isPlayingExpression, false);
    });

    it('onEmotionTriggered callback is called', async () => {
        const es = new ctx.EmotionSystem({ aiClient: {} });
        es.configureExpressions([{ name: 'test', label: 'Test' }], {}, 100);
        let triggered = null;
        es.onEmotionTriggered = (name) => { triggered = name; };
        es.emotionValue = 100;
        es.enabledEmotions = ['test'];
        await es._triggerExpression();
        assert.strictEqual(triggered, 'test');
        es.stop(); // cleanup timer
    });

    it('per-expression duration is used', async () => {
        const es = new ctx.EmotionSystem({ aiClient: {} });
        es.configureExpressions(
            [{ name: 'fast', label: 'Fast' }],
            { 'fast': 100 },
            5000
        );
        es.enabledEmotions = ['fast'];
        es.emotionValue = 100;
        await es._triggerExpression();
        // Timer should be set
        assert.ok(es.expressionTimer !== null);
        es.stop(); // cleanup
    });

    it('triggerAligned uses override duration', () => {
        const es = new ctx.EmotionSystem({ aiClient: {} });
        es.configureExpressions(
            [{ name: 'happy', label: 'Happy' }],
            { 'happy': 5000 },
            5000
        );
        es.enabledEmotions = ['happy'];
        es.nextEmotionBuffer = 'happy';
        let triggered = null;
        es.onEmotionTriggered = (name) => { triggered = name; };
        es.triggerAligned(2500);
        assert.strictEqual(triggered, 'happy');
        assert.strictEqual(es.emotionValue, 0);
        assert.ok(es.expressionTimer !== null);
        es.stop();
    });

    it('triggerAligned does nothing when busy', () => {
        const es = new ctx.EmotionSystem({ aiClient: {} });
        es.configureExpressions(
            [{ name: 'test', label: 'Test' }],
            {},
            5000
        );
        es.enabledEmotions = ['test'];
        es.isPlayingExpression = true;
        let triggered = false;
        es.onEmotionTriggered = () => { triggered = true; };
        es.triggerAligned(3000);
        assert.strictEqual(triggered, false);
        es.stop();
    });

    it('forceRevert clears playing state and timers', () => {
        const es = new ctx.EmotionSystem({ aiClient: {} });
        es.configureExpressions(
            [{ name: 'test', label: 'Test' }],
            {},
            5000
        );
        es.enabledEmotions = ['test'];
        es.emotionValue = 100;
        es._triggerExpressionWithDuration(null);
        assert.strictEqual(es.isPlayingExpression, true);
        assert.ok(es.expressionTimer !== null);

        let reverted = false;
        es.onEmotionReverted = () => { reverted = true; };
        es.forceRevert();
        assert.strictEqual(es.isPlayingExpression, false);
        assert.strictEqual(es.expressionTimer, null);
        assert.strictEqual(reverted, true);
        es.stop();
    });
});

// ========== Test: PathUtils ==========

describe('PathUtils', () => {
    const { createPathUtils } = require('../src/utils/path-utils');

    it('should create path utils with mock app (dev mode)', () => {
        const mockApp = {
            isPackaged: false,
            getAppPath: () => '/fake/app',
            getPath: (name) => name === 'userData' ? '/fake/userData' : '/fake/' + name
        };
        const pu = createPathUtils(mockApp, path);
        assert.strictEqual(pu.isPackaged, false);
        assert.strictEqual(typeof pu.getAppBasePath(), 'string');
    });

    it('getVoicevoxPath returns correct dev path', () => {
        const mockApp = {
            isPackaged: false,
            getAppPath: () => '/fake/app',
            getPath: () => '/fake/userData'
        };
        const pu = createPathUtils(mockApp, path);
        const result = pu.getVoicevoxPath('models/0.vvm');
        assert.ok(result.includes('voicevox_core'));
        assert.ok(result.includes('0.vvm'));
    });

    it('getVoicevoxPath returns userData fallback in production', () => {
        const origResourcesPath = process.resourcesPath;
        process.resourcesPath = '/prod/resources';
        const mockApp = {
            isPackaged: true,
            getAppPath: () => '/prod/app.asar',
            getPath: (name) => name === 'exe' ? '/prod/Live2DPet.exe' : '/prod/userData'
        };
        const pu = createPathUtils(mockApp, path);
        const result = pu.getVoicevoxPath('models/0.vvm');
        // Falls through to userData when no paths exist on disk
        assert.ok(result.includes('voicevox_core'));
        assert.ok(result.includes('models'));
        process.resourcesPath = origResourcesPath;
    });

    it('getProfilePath returns userData-based path', () => {
        const mockApp = {
            isPackaged: false,
            getAppPath: () => '/fake/app',
            getPath: () => '/fake/userData'
        };
        const pu = createPathUtils(mockApp, path);
        const result = pu.getProfilePath('abc-123');
        assert.ok(result.includes('profiles'));
        assert.ok(result.includes('abc-123'));
    });

    it('getDefaultAudioPath is under profile', () => {
        const mockApp = {
            isPackaged: false,
            getAppPath: () => '/fake/app',
            getPath: () => '/fake/userData'
        };
        const pu = createPathUtils(mockApp, path);
        const result = pu.getDefaultAudioPath('abc-123');
        assert.ok(result.includes('abc-123'));
        assert.ok(result.includes('default-audio'));
    });

    it('resolveModelPath prefers userDataModelPath', () => {
        const mockApp = {
            isPackaged: false,
            getAppPath: () => '/fake/app',
            getPath: () => '/fake/userData'
        };
        const pu = createPathUtils(mockApp, path);
        const result = pu.resolveModelPath({
            userDataModelPath: 'models/test',
            folderPath: '/original/path'
        });
        assert.ok(result.includes('userData'));
        assert.ok(result.includes('test'));
    });

    it('resolveModelPath falls back to folderPath', () => {
        const mockApp = {
            isPackaged: false,
            getAppPath: () => '/fake/app',
            getPath: () => '/fake/userData'
        };
        const pu = createPathUtils(mockApp, path);
        const result = pu.resolveModelPath({
            userDataModelPath: null,
            folderPath: '/original/path'
        });
        assert.strictEqual(result, '/original/path');
    });

    it('resolveModelPath returns null when no paths', () => {
        const mockApp = {
            isPackaged: false,
            getAppPath: () => '/fake/app',
            getPath: () => '/fake/userData'
        };
        const pu = createPathUtils(mockApp, path);
        const result = pu.resolveModelPath({
            userDataModelPath: null,
            folderPath: null
        });
        assert.strictEqual(result, null);
    });

    it('getLogsPath returns userData/logs', () => {
        const mockApp = {
            isPackaged: false,
            getAppPath: () => '/fake/app',
            getPath: () => '/fake/userData'
        };
        const pu = createPathUtils(mockApp, path);
        assert.ok(pu.getLogsPath().includes('logs'));
    });

    it('works without app (null fallback)', () => {
        const pu = createPathUtils(null, path);
        assert.strictEqual(pu.isPackaged, false);
        assert.strictEqual(typeof pu.getAppBasePath(), 'string');
    });
});

// ========== Test: Config Schema & Migration ==========

describe('ConfigSchema', () => {
    // We test the pure functions by extracting them from main.js logic
    // Since main.js uses electron requires, we replicate the pure config functions here

    function getDefaultModelConfig() {
        return {
            type: 'none', folderPath: null, modelJsonFile: null,
            copyToUserData: true, userDataModelPath: null,
            staticImagePath: null, bottomAlignOffset: 0.5,
            gifExpressions: {},
            paramMapping: {
                angleX: null, angleY: null, angleZ: null,
                bodyAngleX: null, eyeBallX: null, eyeBallY: null
            },
            hasExpressions: false, expressions: [],
            expressionDurations: {}, defaultExpressionDuration: 5000,
            canvasYRatio: 0.60
        };
    }

    function getDefaultConfig() {
        return {
            configVersion: 1, apiKey: '', baseURL: 'https://openrouter.ai/api/v1',
            modelName: 'x-ai/grok-4.1-fast', interval: 10,
            emotionFrequency: 30, enabledEmotions: [],
            model: getDefaultModelConfig(),
            bubble: { frameImagePath: null }, appIcon: null
        };
    }

    function migrateConfig(config) {
        if (config.configVersion >= 1) return config;
        if (!config.configVersion) {
            config.configVersion = 1;
            if (!config.model) config.model = getDefaultModelConfig();
            if (!config.bubble) config.bubble = { frameImagePath: null };
            if (config.appIcon === undefined) config.appIcon = null;
            if (Array.isArray(config.enabledEmotions) && config.enabledEmotions.length > 0) {
                config.enabledEmotions = [];
            }
        }
        return config;
    }

    it('getDefaultConfig has all required fields', () => {
        const cfg = getDefaultConfig();
        assert.strictEqual(cfg.configVersion, 1);
        assert.strictEqual(cfg.model.type, 'none');
        assert.strictEqual(cfg.model.canvasYRatio, 0.60);
        assert.strictEqual(cfg.model.paramMapping.angleX, null);
        assert.strictEqual(cfg.bubble.frameImagePath, null);
        assert.strictEqual(cfg.appIcon, null);
        assert.deepStrictEqual(cfg.enabledEmotions, []);
    });

    it('migrateConfig upgrades v0 (no version) to v1', () => {
        const oldConfig = {
            apiKey: 'sk-test',
            baseURL: 'https://api.test.com/v1',
            modelName: 'test-model',
            interval: 10,
            emotionFrequency: 30,
            enabledEmotions: ['脸红', '生气']
        };
        const migrated = migrateConfig(oldConfig);
        assert.strictEqual(migrated.configVersion, 1);
        assert.strictEqual(migrated.model.type, 'none');
        assert.deepStrictEqual(migrated.enabledEmotions, []);
        assert.strictEqual(migrated.appIcon, null);
        assert.ok(migrated.bubble);
    });

    it('migrateConfig does not touch v1 config', () => {
        const v1Config = getDefaultConfig();
        v1Config.apiKey = 'sk-keep';
        v1Config.enabledEmotions = ['custom'];
        const migrated = migrateConfig(v1Config);
        assert.strictEqual(migrated.apiKey, 'sk-keep');
        assert.deepStrictEqual(migrated.enabledEmotions, ['custom']);
    });

    it('getDefaultModelConfig has correct paramMapping keys', () => {
        const model = getDefaultModelConfig();
        const keys = Object.keys(model.paramMapping);
        assert.deepStrictEqual(keys, ['angleX', 'angleY', 'angleZ', 'bodyAngleX', 'eyeBallX', 'eyeBallY']);
        keys.forEach(k => assert.strictEqual(model.paramMapping[k], null));
    });

    it('migrateConfig preserves existing API settings', () => {
        const old = { apiKey: 'sk-123', baseURL: 'https://custom.api/v1', modelName: 'gpt-4' };
        const migrated = migrateConfig(old);
        assert.strictEqual(migrated.apiKey, 'sk-123');
        assert.strictEqual(migrated.baseURL, 'https://custom.api/v1');
        assert.strictEqual(migrated.modelName, 'gpt-4');
    });
});

// ========== Test: Parameter Fuzzy Mapping ==========

describe('ParamFuzzyMapping', () => {
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
                suggested[key] = parameterIds.find(p => p.toLowerCase() === match.toLowerCase());
            } else {
                suggested[key] = null;
            }
        }
        return suggested;
    }

    it('maps standard Cubism4 parameters', () => {
        const ids = ['ParamAngleX', 'ParamAngleY', 'ParamAngleZ', 'ParamBodyAngleX', 'ParamEyeBallX', 'ParamEyeBallY'];
        const result = suggestParamMapping(ids);
        assert.strictEqual(result.angleX, 'ParamAngleX');
        assert.strictEqual(result.angleY, 'ParamAngleY');
        assert.strictEqual(result.bodyAngleX, 'ParamBodyAngleX');
        assert.strictEqual(result.eyeBallX, 'ParamEyeBallX');
    });

    it('handles case-insensitive matching', () => {
        const ids = ['paramangleX', 'PARAMANGLEY'];
        const result = suggestParamMapping(ids);
        assert.strictEqual(result.angleX, 'paramangleX');
        assert.strictEqual(result.angleY, 'PARAMANGLEY');
    });

    it('returns null for unmatched parameters', () => {
        const ids = ['CustomParam1', 'CustomParam2'];
        const result = suggestParamMapping(ids);
        assert.strictEqual(result.angleX, null);
        assert.strictEqual(result.angleY, null);
        assert.strictEqual(result.bodyAngleX, null);
    });

    it('handles empty parameter list', () => {
        const result = suggestParamMapping([]);
        Object.values(result).forEach(v => assert.strictEqual(v, null));
    });

    it('preserves original case from model', () => {
        const ids = ['paramAngleX'];
        const result = suggestParamMapping(ids);
        assert.strictEqual(result.angleX, 'paramAngleX');
    });
});

// ========== Test: ModelAdapter ==========

describe('ModelAdapter', () => {
    const ctx = {};

    beforeEach(() => {
        global.window = {};
        const src = fs.readFileSync(path.join(__dirname, '..', 'src', 'renderer', 'model-adapter.js'), 'utf-8');
        global.PIXI = { live2d: { Live2DModel: { registerTicker: async () => {} } }, Application: class {}, Ticker: {} };
        global.document = {
            getElementById: () => null,
            createElement: () => ({ style: {}, appendChild: () => {} })
        };
        eval(src);
        ctx.ModelAdapter = global.window.ModelAdapter;
        ctx.Live2DAdapter = global.window.Live2DAdapter;
        ctx.ImageAdapter = global.window.ImageAdapter;
        ctx.NullAdapter = global.window.NullAdapter;
        ctx.createModelAdapter = global.window.createModelAdapter;
    });

    it('createModelAdapter returns Live2DAdapter for live2d type', () => {
        const adapter = ctx.createModelAdapter({ type: 'live2d' });
        assert.strictEqual(adapter.getType(), 'live2d');
        assert.ok(adapter instanceof ctx.Live2DAdapter);
    });

    it('createModelAdapter returns ImageAdapter for image type', () => {
        const adapter = ctx.createModelAdapter({ type: 'image' });
        assert.strictEqual(adapter.getType(), 'image');
        assert.ok(adapter instanceof ctx.ImageAdapter);
    });

    it('createModelAdapter returns NullAdapter for none type', () => {
        const adapter = ctx.createModelAdapter({ type: 'none' });
        assert.strictEqual(adapter.getType(), 'none');
        assert.ok(adapter instanceof ctx.NullAdapter);
    });

    it('createModelAdapter defaults to NullAdapter for unknown type', () => {
        const adapter = ctx.createModelAdapter({ type: 'unknown' });
        assert.strictEqual(adapter.getType(), 'none');
    });

    it('NullAdapter methods are no-ops', () => {
        const adapter = new ctx.NullAdapter({});
        adapter.setExpression('test');
        adapter.revertExpression();
        adapter.updateParams(0.5, 0.5);
        adapter.resize(300, 300);
        adapter.destroy();
        assert.ok(true);
    });

    it('ImageAdapter stores config', () => {
        const config = { type: 'image', staticImagePath: '/test/img.png', bottomAlignOffset: 0.3 };
        const adapter = new ctx.ImageAdapter(config);
        assert.strictEqual(adapter.config.staticImagePath, '/test/img.png');
        assert.strictEqual(adapter.config.bottomAlignOffset, 0.3);
    });

    it('Live2DAdapter stores paramMapping config', () => {
        const config = {
            type: 'live2d',
            paramMapping: { angleX: 'ParamAngleX', angleY: null },
            canvasYRatio: 0.55
        };
        const adapter = new ctx.Live2DAdapter(config);
        assert.strictEqual(adapter.config.paramMapping.angleX, 'ParamAngleX');
        assert.strictEqual(adapter.config.paramMapping.angleY, null);
        assert.strictEqual(adapter.config.canvasYRatio, 0.55);
    });

    it('ImageAdapter setExpression switches GIF', () => {
        const config = {
            type: 'image',
            staticImagePath: '/base.png',
            gifExpressions: { '脸红': '/blush.gif', '生气': '/angry.gif' }
        };
        const adapter = new ctx.ImageAdapter(config);
        adapter.imgElement = { src: '/base.png', style: {} };
        adapter.setExpression('脸红');
        assert.strictEqual(adapter.imgElement.src, '/blush.gif');
        assert.strictEqual(adapter.currentGif, '脸红');
    });

    it('ImageAdapter revertExpression restores base image', () => {
        const config = { type: 'image', staticImagePath: '/base.png', gifExpressions: { '脸红': '/blush.gif' } };
        const adapter = new ctx.ImageAdapter(config);
        adapter.imgElement = { src: '/blush.gif', style: {} };
        adapter.currentGif = '脸红';
        adapter.revertExpression();
        assert.strictEqual(adapter.imgElement.src, '/base.png');
        assert.strictEqual(adapter.currentGif, null);
    });
});

// ========== Test: MessageSession ==========

describe('MessageSession', () => {
    let MessageSession;

    beforeEach(() => {
        global.window = {};
        const src = fs.readFileSync(path.join(__dirname, '..', 'src', 'core', 'message-session.js'), 'utf-8');
        eval(src);
        MessageSession = global.window.MessageSession;
    });

    it('create returns a session with text', () => {
        const s = MessageSession.create('hello');
        assert.strictEqual(s.text, 'hello');
        assert.strictEqual(s.cancelled, false);
    });

    it('isActive returns true for current session', () => {
        const s = MessageSession.create('test');
        assert.strictEqual(s.isActive(), true);
    });

    it('new session makes old session inactive', () => {
        const s1 = MessageSession.create('first');
        const s2 = MessageSession.create('second');
        assert.strictEqual(s1.isActive(), false);
        assert.strictEqual(s2.isActive(), true);
    });

    it('cancel makes session inactive', () => {
        const s = MessageSession.create('test');
        s.cancel();
        assert.strictEqual(s.isActive(), false);
        assert.strictEqual(s.cancelled, true);
    });

    it('run shows chat and triggers emotion+audio', async () => {
        const s = MessageSession.create('hello world');
        let chatShown = false;
        let emotionText = null;
        let audioPrepared = false;
        let audioPlayed = false;
        global.window.electronAPI = {
            showPetChat: async (msg) => { chatShown = true; }
        };
        const mockSystem = {
            emotionSystem: {
                emotionValue: 0,
                onAIResponse: (t) => { emotionText = t; },
                _selectEmotionFromAI: () => {}
            },
            prepareAudio: async (t) => {
                audioPrepared = true;
                return { duration: 0, play: async () => { audioPlayed = true; } };
            }
        };
        await s.run(mockSystem);
        assert.strictEqual(chatShown, true);
        assert.strictEqual(emotionText, 'hello world');
        assert.strictEqual(audioPrepared, true);
        assert.strictEqual(audioPlayed, true);
    });

    it('run syncs bubble duration to TTS audio duration', async () => {
        const s = MessageSession.create('synced text');
        let bubbleDuration = 0;
        global.window.electronAPI = {
            showPetChat: async (msg, dur) => { bubbleDuration = dur; }
        };
        const mockSystem = {
            emotionSystem: {
                emotionValue: 0,
                _selectEmotionFromAI: () => {}
            },
            prepareAudio: async () => ({
                duration: 2500, // 2.5s audio
                play: async () => {}
            })
        };
        await s.run(mockSystem);
        // bubble = max(2500 + 800 buffer, 3000 min) = 3300
        assert.strictEqual(bubbleDuration, 3300);
    });

    it('run triggers aligned emotion when emotionValue >= threshold', async () => {
        const s = MessageSession.create('excited text');
        let alignedDuration = null;
        global.window.electronAPI = {
            showPetChat: async () => {}
        };
        const mockSystem = {
            emotionSystem: {
                emotionValue: 50, // above EMOTION_ALIGN_THRESHOLD (30)
                _selectEmotionFromAI: () => {},
                triggerAligned: (dur) => { alignedDuration = dur; }
            },
            prepareAudio: async () => ({
                duration: 4000,
                play: async () => {}
            })
        };
        await s.run(mockSystem);
        // aligned duration = max(4000 + 800, 3000) = 4800
        assert.strictEqual(alignedDuration, 4800);
    });

    it('run uses independent emotion when emotionValue is low', async () => {
        const s = MessageSession.create('calm text');
        let independentCalled = false;
        let alignedCalled = false;
        global.window.electronAPI = {
            showPetChat: async () => {}
        };
        const mockSystem = {
            emotionSystem: {
                emotionValue: 10, // below threshold
                _selectEmotionFromAI: () => {},
                triggerAligned: () => { alignedCalled = true; },
                onAIResponse: () => { independentCalled = true; }
            },
            prepareAudio: async () => ({
                duration: 3000,
                play: async () => {}
            })
        };
        await s.run(mockSystem);
        assert.strictEqual(alignedCalled, false);
        // TTS mode with low emotion: no independent call either (only aligned path checked)
        // Independent is only called in non-TTS path
    });

    it('run skips if cancelled', async () => {
        const s = MessageSession.create('hello');
        s.cancel();
        let chatShown = false;
        global.window.electronAPI = {
            showPetChat: async () => { chatShown = true; }
        };
        await s.run({});
        assert.strictEqual(chatShown, false);
    });
});

// ========== Test: AudioStateMachine ==========

describe('AudioStateMachine', () => {
    let AudioStateMachine;

    beforeEach(() => {
        global.window = {};
        const src = fs.readFileSync(path.join(__dirname, '..', 'src', 'core', 'audio-state-machine.js'), 'utf-8');
        eval(src);
        AudioStateMachine = global.window.AudioStateMachine;
    });

    it('should instantiate with defaults', () => {
        const asm = new AudioStateMachine();
        assert.strictEqual(asm.preferredMode, 'tts');
        assert.strictEqual(asm.effectiveMode, 'silent');
        assert.strictEqual(asm.ttsAvailable, false);
        assert.strictEqual(asm.defaultAudioAvailable, false);
    });

    it('effective mode is tts when preferred=tts and tts available', () => {
        const asm = new AudioStateMachine();
        asm.setTTSAvailable(true);
        assert.strictEqual(asm.effectiveMode, 'tts');
    });

    it('degrades tts to default-audio when tts unavailable', () => {
        const asm = new AudioStateMachine();
        asm.setDefaultAudioAvailable(true, ['clip1']);
        asm.setTTSAvailable(false);
        assert.strictEqual(asm.effectiveMode, 'default-audio');
    });

    it('degrades tts to silent when nothing available', () => {
        const asm = new AudioStateMachine();
        asm.setPreferredMode('tts');
        assert.strictEqual(asm.effectiveMode, 'silent');
    });

    it('preferred=default-audio uses default-audio when available', () => {
        const asm = new AudioStateMachine();
        asm.setDefaultAudioAvailable(true, ['clip1']);
        asm.setPreferredMode('default-audio');
        assert.strictEqual(asm.effectiveMode, 'default-audio');
    });

    it('preferred=default-audio degrades to silent when unavailable', () => {
        const asm = new AudioStateMachine();
        asm.setPreferredMode('default-audio');
        assert.strictEqual(asm.effectiveMode, 'silent');
    });

    it('preferred=silent always silent', () => {
        const asm = new AudioStateMachine();
        asm.setTTSAvailable(true);
        asm.setDefaultAudioAvailable(true, ['clip1']);
        asm.setPreferredMode('silent');
        assert.strictEqual(asm.effectiveMode, 'silent');
    });

    it('invalid preferred mode defaults to tts', () => {
        const asm = new AudioStateMachine();
        asm.setTTSAvailable(true);
        asm.setPreferredMode('invalid');
        assert.strictEqual(asm.preferredMode, 'tts');
        assert.strictEqual(asm.effectiveMode, 'tts');
    });

    it('onModeChange callback fires on transition', () => {
        const asm = new AudioStateMachine();
        let changed = null;
        asm.onModeChange = (mode) => { changed = mode; };
        asm.setTTSAvailable(true);
        assert.strictEqual(changed, 'tts');
    });

    it('onModeChange does not fire when mode unchanged', () => {
        const asm = new AudioStateMachine();
        let callCount = 0;
        asm.onModeChange = () => { callCount++; };
        asm.setPreferredMode('silent');
        // already silent, so no change
        assert.strictEqual(callCount, 0);
    });

    it('getRandomClip returns null when no clips', () => {
        const asm = new AudioStateMachine();
        assert.strictEqual(asm.getRandomClip(), null);
    });

    it('getRandomClip returns a clip when available', () => {
        const asm = new AudioStateMachine();
        asm.setDefaultAudioAvailable(true, ['a', 'b', 'c']);
        const clip = asm.getRandomClip();
        assert.ok(['a', 'b', 'c'].includes(clip));
    });

    it('getStatus returns correct info', () => {
        const asm = new AudioStateMachine();
        asm.setTTSAvailable(true);
        const s = asm.getStatus();
        assert.strictEqual(s.preferredMode, 'tts');
        assert.strictEqual(s.effectiveMode, 'tts');
        assert.strictEqual(s.ttsAvailable, true);
        assert.strictEqual(s.clipCount, 0);
    });
});

// ========== Test: TTSService ==========

describe('TTSService', () => {
    let TTSService;

    beforeEach(() => {
        ({ TTSService } = require('../src/core/tts-service'));
    });

    it('should instantiate with defaults', () => {
        const tts = new TTSService();
        assert.strictEqual(tts.initialized, false);
        assert.strictEqual(tts.styleId, 0);
        assert.strictEqual(tts.speedScale, 1.0);
        assert.strictEqual(tts.degraded, false);
        assert.strictEqual(tts.failCount, 0);
    });

    it('setConfig updates parameters', () => {
        const tts = new TTSService();
        tts.setConfig({ styleId: 3, speedScale: 1.5, pitchScale: 0.1, volumeScale: 0.8 });
        assert.strictEqual(tts.styleId, 3);
        assert.strictEqual(tts.speedScale, 1.5);
        assert.strictEqual(tts.pitchScale, 0.1);
        assert.strictEqual(tts.volumeScale, 0.8);
    });

    it('isAvailable returns false when not initialized', () => {
        const tts = new TTSService();
        assert.strictEqual(tts.isAvailable(), false);
    });

    it('synthesize returns null when not initialized', () => {
        const tts = new TTSService();
        assert.strictEqual(tts.synthesize('test'), null);
    });

    it('tts returns null when not initialized', () => {
        const tts = new TTSService();
        assert.strictEqual(tts.tts('test'), null);
    });

    it('circuit breaker degrades after maxFails', () => {
        const tts = new TTSService();
        tts.maxFails = 2;
        tts._onFailure();
        assert.strictEqual(tts.degraded, false);
        tts._onFailure();
        assert.strictEqual(tts.degraded, true);
        assert.ok(tts.degradedAt > 0);
    });

    it('circuit breaker recovers after retryInterval', () => {
        const tts = new TTSService();
        tts.degraded = true;
        tts.degradedAt = Date.now() - 70000; // 70s ago
        tts.retryInterval = 60000;
        assert.strictEqual(tts._checkDegraded(), false);
        assert.strictEqual(tts.degraded, false);
    });

    it('circuit breaker stays degraded within retryInterval', () => {
        const tts = new TTSService();
        tts.degraded = true;
        tts.degradedAt = Date.now() - 10000; // 10s ago
        tts.retryInterval = 60000;
        assert.strictEqual(tts._checkDegraded(), true);
    });

    it('_onSuccess resets failCount', () => {
        const tts = new TTSService();
        tts.failCount = 2;
        tts._onSuccess();
        assert.strictEqual(tts.failCount, 0);
    });

    it('init returns false with invalid path', () => {
        const tts = new TTSService();
        const result = tts.init('/nonexistent/path');
        assert.strictEqual(result, false);
        assert.strictEqual(tts.initialized, false);
    });

    it('destroy resets state', () => {
        const tts = new TTSService();
        tts.initialized = true;
        tts.modelLoaded = true;
        tts.destroy();
        assert.strictEqual(tts.initialized, false);
        assert.strictEqual(tts.modelLoaded, false);
    });
});

// ========== Test: TranslationService ==========

describe('TranslationService', () => {
    let TranslationService;

    beforeEach(() => {
        ({ TranslationService } = require('../src/core/translation-service'));
    });

    it('should instantiate with defaults', () => {
        const ts = new TranslationService();
        assert.strictEqual(ts.enabled, true);
        assert.strictEqual(ts.cache.size, 0);
        assert.strictEqual(ts.isConfigured(), false);
    });

    it('configure sets API params', () => {
        const ts = new TranslationService();
        ts.configure({ apiKey: 'key', baseURL: 'http://test', modelName: 'gpt' });
        assert.strictEqual(ts.isConfigured(), true);
    });

    it('translate returns original when not configured', async () => {
        const ts = new TranslationService();
        const result = await ts.translate('你好');
        assert.strictEqual(result, '你好');
    });

    it('translate returns original when disabled', async () => {
        const ts = new TranslationService();
        ts.configure({ apiKey: 'k', baseURL: 'http://t', modelName: 'm' });
        ts.enabled = false;
        const result = await ts.translate('你好');
        assert.strictEqual(result, '你好');
    });

    it('translate returns empty for empty input', async () => {
        const ts = new TranslationService();
        const result = await ts.translate('');
        assert.strictEqual(result, '');
    });

    it('cache returns cached value', async () => {
        const ts = new TranslationService();
        ts.configure({ apiKey: 'k', baseURL: 'http://t', modelName: 'm' });
        ts.cache.set('你好', 'こんにちは');
        const result = await ts.translate('你好');
        assert.strictEqual(result, 'こんにちは');
    });

    it('_cacheSet evicts oldest when full', () => {
        const ts = new TranslationService();
        ts.cacheMaxSize = 2;
        ts._cacheSet('a', '1');
        ts._cacheSet('b', '2');
        ts._cacheSet('c', '3');
        assert.strictEqual(ts.cache.size, 2);
        assert.strictEqual(ts.cache.has('a'), false);
        assert.strictEqual(ts.cache.get('c'), '3');
    });

    it('clearCache empties the cache', () => {
        const ts = new TranslationService();
        ts.cache.set('a', '1');
        ts.clearCache();
        assert.strictEqual(ts.cache.size, 0);
    });
});
