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
        assert.strictEqual(client.baseURL, 'https://api.x.ai/v1');
        assert.strictEqual(client.modelName, 'grok-4.1-fast');
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

    it('saveConfig persists to localStorage', () => {
        const client = new AIChatClient();
        client.saveConfig({ apiKey: 'sk-123', baseURL: 'https://test.com/v1', modelName: 'gpt-4' });
        assert.strictEqual(client.apiKey, 'sk-123');
        assert.strictEqual(client.baseURL, 'https://test.com/v1');
        assert.strictEqual(client.modelName, 'gpt-4');

        const saved = JSON.parse(global.localStorage.getItem('pet_ai_config'));
        assert.strictEqual(saved.apiKey, 'sk-123');
    });

    it('loadConfig reads from localStorage', async () => {
        global.localStorage.setItem('pet_ai_config', JSON.stringify({
            apiKey: 'sk-saved', baseURL: 'https://saved.com/v1', modelName: 'saved-model'
        }));
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
        assert.strictEqual(config.baseURL, 'https://api.x.ai/v1');
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
        assert.strictEqual(builder.genderTerm, '你');
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

        const sysSrc = fs.readFileSync(path.join(__dirname, '..', 'src', 'core', 'desktop-pet-system.js'), 'utf-8');
        eval(sysSrc);
        DesktopPetSystem = global.window.DesktopPetSystem;
    });

    it('should instantiate with defaults', () => {
        const sys = new DesktopPetSystem();
        assert.strictEqual(sys.isActive, false);
        assert.strictEqual(sys.detectionIntervalMs, 30000);
        assert.deepStrictEqual(sys.chatHistory, []);
        assert.strictEqual(sys.maxHistoryPairs, 3);
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
        sys.chatHistory = [{ role: 'user', content: 'test' }];
        sys.emotionSystem = { stop() {} };
        global.window.electronAPI = { closePetWindow: async () => ({}) };
        await sys.stop();
        assert.strictEqual(sys.isActive, false);
        assert.deepStrictEqual(sys.chatHistory, []);
    });
});

// ========== Test: EmotionSystem ==========

describe('EmotionSystem', () => {
    let EmotionSystem;

    beforeEach(() => {
        global.window = {};
        global.fetch = async () => { throw new Error('fetch not mocked'); };

        const src = fs.readFileSync(path.join(__dirname, '..', 'src', 'core', 'emotion-system.js'), 'utf-8');
        eval(src);
        EmotionSystem = global.window.EmotionSystem;
    });

    it('should instantiate with defaults', () => {
        const es = new EmotionSystem({ aiClient: {} });
        assert.strictEqual(es.emotionValue, 0);
        assert.strictEqual(es.emotionThreshold, 100);
        assert.strictEqual(es.expectedFrequencySeconds, 60);
        assert.strictEqual(es.isPlayingExpression, false);
        assert.strictEqual(es.nextEmotionBuffer, null);
        assert.strictEqual(es.enabledEmotions.length, 5);
    });

    it('_recalculateRates computes correct base rate', () => {
        const es = new EmotionSystem({ aiClient: {} });
        assert.ok(Math.abs(es.baseAccumulationRate - 100 / 60) < 0.001);
        assert.ok(Math.abs(es.hoverAccumulationRate - es.baseAccumulationRate * 0.5) < 0.001);
    });

    it('setExpectedFrequency enforces minimum 30', () => {
        const es = new EmotionSystem({ aiClient: {} });
        es.setExpectedFrequency(10);
        assert.strictEqual(es.expectedFrequencySeconds, 30);
    });

    it('setExpectedFrequency recalculates rates', () => {
        const es = new EmotionSystem({ aiClient: {} });
        es.setExpectedFrequency(120);
        assert.strictEqual(es.expectedFrequencySeconds, 120);
        assert.ok(Math.abs(es.baseAccumulationRate - 100 / 120) < 0.001);
    });

    it('_tick accumulates base rate', () => {
        const es = new EmotionSystem({ aiClient: {} });
        es._tick();
        assert.ok(Math.abs(es.emotionValue - es.baseAccumulationRate) < 0.001);
    });

    it('_tick adds hover bonus when hovering', () => {
        const es = new EmotionSystem({ aiClient: {} });
        es.setHoverState(true);
        es._tick();
        const expected = es.baseAccumulationRate + es.hoverAccumulationRate;
        assert.ok(Math.abs(es.emotionValue - expected) < 0.001);
    });

    it('_tick does not accumulate during expression playback', () => {
        const es = new EmotionSystem({ aiClient: {} });
        es.isPlayingExpression = true;
        es._tick();
        assert.strictEqual(es.emotionValue, 0);
    });

    it('onAIResponse adds bonus', () => {
        const es = new EmotionSystem({ aiClient: { callAPI: async () => '脸红' } });
        es.onAIResponse('Hello world test response');
        assert.ok(es.emotionValue > 0);
    });

    it('setEnabledEmotions filters invalid names', () => {
        const es = new EmotionSystem({ aiClient: {} });
        es.setEnabledEmotions(['脸红', 'invalid', '生气']);
        assert.deepStrictEqual(es.enabledEmotions, ['脸红', '生气']);
    });

    it('stop resets all state', () => {
        const es = new EmotionSystem({ aiClient: {} });
        es.emotionValue = 50;
        es.nextEmotionBuffer = '脸红';
        es.isPlayingExpression = true;
        es.stop();
        assert.strictEqual(es.emotionValue, 0);
        assert.strictEqual(es.nextEmotionBuffer, null);
        assert.strictEqual(es.isPlayingExpression, false);
    });
});
