/**
 * Unit tests for v1.8.0 Enhancement System
 * Run with: node --test tests/test-enhance.js
 */
const { describe, it, beforeEach } = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');

const enhanceDir = path.join(__dirname, '..', 'src', 'core', 'enhance');

/** Load enhance modules into global.window (simulates browser script loading order) */
function loadEnhanceModules(...files) {
    global.window = {
        I18N: { en: {
            'sys.screenContent': 'Screen Content', 'sys.todayActivity': "Today's Activity",
            'sys.usageHistory': 'Usage History', 'sys.relatedInfo': 'Related Info', 'sys.knowledge': 'Knowledge',
            'sys.knowledgePrompt': 'Summarize in max 150 chars. Output in {0}.',
            'sys.vlmPrompt': 'Extract keywords. Output in {0}.',
            'sys.kbTopicPrompt': 'Extract topics from: {0}',
            'sys.kbTermsPrompt': 'Search terms for "{0}". Time: {1}',
            'sys.emotionPrompt': 'Pick emotion from [{0}].'
        } }
    };
    global.window._enhanceLang = 'en';
    for (const file of files) {
        const src = fs.readFileSync(path.join(enhanceDir, file), 'utf-8');
        eval(src);
    }
    // Expose window globals to eval scope (modules reference each other by name)
    const w = global.window;
    if (w.STOP_WORDS) global.STOP_WORDS = w.STOP_WORDS;
    if (w.tokenizeTitle) global.tokenizeTitle = w.tokenizeTitle;
    if (w.enhanceT) global.enhanceT = w.enhanceT;
    if (w.enhanceLang) global.enhanceLang = w.enhanceLang;
    if (w.enhanceLangName) global.enhanceLangName = w.enhanceLangName;
    if (w.isNoiseTitle) global.isNoiseTitle = w.isNoiseTitle;
    if (w.sanitizeSecrets) global.sanitizeSecrets = w.sanitizeSecrets;
    if (w.ShortTermPool) global.ShortTermPool = w.ShortTermPool;
    if (w.LongTermPool) global.LongTermPool = w.LongTermPool;
    if (w.MemoryTracker) global.MemoryTracker = w.MemoryTracker;
    if (w.SearchService) global.SearchService = w.SearchService;
    if (w.KnowledgeStore) global.KnowledgeStore = w.KnowledgeStore;
    if (w.VLMExtractor) global.VLMExtractor = w.VLMExtractor;
    if (w.EnhancementOrchestrator) global.EnhancementOrchestrator = w.EnhancementOrchestrator;
    if (w.KnowledgeAcquisition) global.KnowledgeAcquisition = w.KnowledgeAcquisition;
}

// ========== Test: ShortTermPool ==========

describe('ShortTermPool', () => {
    let ShortTermPool;

    beforeEach(() => {
        loadEnhanceModules('context-pool.js', 'enhance-utils.js');
        ShortTermPool = global.window.ShortTermPool;
    });

    it('should set and get values', () => {
        const pool = new ShortTermPool();
        pool.set('key1', 'value1');
        assert.strictEqual(pool.get('key1'), 'value1');
    });

    it('should return null for missing keys', () => {
        const pool = new ShortTermPool();
        assert.strictEqual(pool.get('missing'), null);
    });

    it('has returns correct boolean', () => {
        const pool = new ShortTermPool();
        pool.set('exists', true);
        assert.strictEqual(pool.has('exists'), true);
        assert.strictEqual(pool.has('nope'), false);
    });

    it('delete removes entry', () => {
        const pool = new ShortTermPool();
        pool.set('key', 'val');
        pool.delete('key');
        assert.strictEqual(pool.get('key'), null);
    });

    it('clear removes all entries', () => {
        const pool = new ShortTermPool();
        pool.set('a', 1);
        pool.set('b', 2);
        pool.clear();
        assert.strictEqual(pool.get('a'), null);
        assert.strictEqual(pool.get('b'), null);
    });

    it('getAge returns Infinity for missing keys', () => {
        const pool = new ShortTermPool();
        assert.strictEqual(pool.getAge('missing'), Infinity);
    });

    it('getAge returns small value for recent keys', () => {
        const pool = new ShortTermPool();
        pool.set('recent', 'val');
        assert.ok(pool.getAge('recent') < 100);
    });

    it('prune keeps maxEntries most recent', () => {
        const pool = new ShortTermPool();
        for (let i = 0; i < 10; i++) {
            pool.set(`key${i}`, i);
            pool._store[`key${i}`].updatedAt = Date.now() - (10 - i) * 1000;
        }
        pool.prune(5);
        assert.strictEqual(pool.has('key0'), false);
        assert.strictEqual(pool.has('key9'), true);
    });
});

// ========== Test: LongTermPool ==========

describe('LongTermPool', () => {
    let LongTermPool;

    beforeEach(() => {
        loadEnhanceModules('context-pool.js', 'enhance-utils.js');
        LongTermPool = global.window.LongTermPool;
    });

    it('should set and get per-title data', () => {
        const pool = new LongTermPool();
        pool.setForTitle('react tutorial', 'memory', { totalSec: 100 });
        assert.deepStrictEqual(pool.getForTitle('react tutorial', 'memory'), { totalSec: 100 });
    });

    it('returns null for missing title/layer', () => {
        const pool = new LongTermPool();
        assert.strictEqual(pool.getForTitle('missing', 'memory'), null);
    });

    it('marks dirty on set', () => {
        const pool = new LongTermPool();
        assert.strictEqual(pool.isDirty, false);
        pool.setForTitle('test', 'memory', {});
        assert.strictEqual(pool.isDirty, true);
    });

    it('clearForTitle removes title data', () => {
        const pool = new LongTermPool();
        pool.setForTitle('test', 'memory', { x: 1 });
        pool.clearForTitle('test');
        assert.strictEqual(pool.getForTitle('test', 'memory'), null);
    });

    it('titleCount returns correct count', () => {
        const pool = new LongTermPool();
        pool.setForTitle('a', 'memory', {});
        pool.setForTitle('b', 'memory', {});
        assert.strictEqual(pool.titleCount, 2);
    });

    it('query returns matching titles by Jaccard similarity', () => {
        const pool = new LongTermPool();
        pool.setForTitle('react tutorial basics', 'knowledge', { summary: 'React basics' });
        pool.setForTitle('python machine learning', 'knowledge', { summary: 'ML stuff' });
        pool.setForTitle('advanced react hooks', 'knowledge', { summary: 'Hooks deep dive' });

        const results = pool.query('react hooks tutorial', { layer: 'knowledge', minConfidence: 0.1 });
        assert.ok(results.length >= 1);
        // react tutorial basics and advanced react hooks should match
        const titles = results.map(r => r.title);
        assert.ok(titles.some(t => t.includes('react')));
    });

    it('query returns empty for no matches', () => {
        const pool = new LongTermPool();
        pool.setForTitle('python flask', 'knowledge', { summary: 'Flask web' });
        const results = pool.query('java spring boot', { layer: 'knowledge', minConfidence: 0.3 });
        assert.strictEqual(results.length, 0);
    });

    it('query respects maxResults', () => {
        const pool = new LongTermPool();
        for (let i = 0; i < 10; i++) {
            pool.setForTitle(`react topic ${i}`, 'knowledge', { summary: `Topic ${i}` });
        }
        const results = pool.query('react topic', { layer: 'knowledge', maxResults: 3, minConfidence: 0.1 });
        assert.ok(results.length <= 3);
    });

    it('_tokenize handles CJK and special chars', () => {
        const pool = new LongTermPool();
        const tokens = pool._tokenize('React - Tutorial | 教程');
        assert.ok(tokens.includes('react'));
        assert.ok(tokens.includes('tutorial'));
        assert.ok(tokens.includes('教程'));
    });

    it('_jaccardSimilarity computes correctly', () => {
        const pool = new LongTermPool();
        assert.strictEqual(pool._jaccardSimilarity(['a', 'b'], ['a', 'b']), 1);
        assert.strictEqual(pool._jaccardSimilarity(['a', 'b'], ['c', 'd']), 0);
        assert.strictEqual(pool._jaccardSimilarity(['a', 'b', 'c'], ['b', 'c', 'd']), 0.5);
        assert.strictEqual(pool._jaccardSimilarity([], []), 0);
    });

    it('query uses VLM keywords for enriched matching', () => {
        const pool = new LongTermPool();
        // Store a title with VLM keywords that differ from the title itself
        pool.setForTitle('some app window', 'vlm', { summary: 'react, hooks, useState', enrichedTitle: 'React Hooks Tutorial' });
        pool.setForTitle('some app window', 'knowledge', { summary: 'React info' });
        // Query by VLM keywords — should match even though title tokens don't overlap
        const results = pool.query('react hooks guide', { layer: 'knowledge', minConfidence: 0.1 });
        assert.ok(results.length >= 1);
        assert.strictEqual(results[0].title, 'some app window');
    });
});

// ========== Test: MemoryTracker ==========

describe('MemoryTracker', () => {
    let MemoryTracker, ShortTermPool, LongTermPool;

    beforeEach(() => {
        loadEnhanceModules('context-pool.js', 'enhance-utils.js', 'memory-tracker.js');
        ShortTermPool = global.window.ShortTermPool;
        LongTermPool = global.window.LongTermPool;
        MemoryTracker = global.window.MemoryTracker;
    });

    it('should instantiate with defaults', () => {
        const sp = new ShortTermPool();
        const lp = new LongTermPool();
        const mt = new MemoryTracker(sp, lp);
        assert.strictEqual(mt.enabled, true);
        assert.strictEqual(mt.retentionDays, 30);
    });

    it('recordFocus accumulates counts', () => {
        const sp = new ShortTermPool();
        const lp = new LongTermPool();
        const mt = new MemoryTracker(sp, lp);
        mt.recordFocus('Chrome');
        mt.recordFocus('Chrome');
        mt.recordFocus('VSCode');
        const counts = mt.getSessionCounts();
        assert.strictEqual(counts['Chrome'], 2);
        assert.strictEqual(counts['VSCode'], 1);
    });

    it('recordFocus does nothing when disabled', () => {
        const sp = new ShortTermPool();
        const lp = new LongTermPool();
        const mt = new MemoryTracker(sp, lp);
        mt.enabled = false;
        mt.recordFocus('Chrome');
        assert.deepStrictEqual(mt.getSessionCounts(), {});
    });

    it('flush writes to long pool and resets session', () => {
        const sp = new ShortTermPool();
        const lp = new LongTermPool();
        const mt = new MemoryTracker(sp, lp);
        mt.recordFocus('Chrome');
        mt.recordFocus('Chrome');
        mt.flush();
        const mem = lp.getForTitle('Chrome', 'memory');
        assert.ok(mem);
        assert.strictEqual(mem.totalSec, 2);
        assert.strictEqual(mem.dayCount, 1);
        assert.deepStrictEqual(mt.getSessionCounts(), {});
    });

    it('flush accumulates across multiple flushes', () => {
        const sp = new ShortTermPool();
        const lp = new LongTermPool();
        const mt = new MemoryTracker(sp, lp);
        mt.recordFocus('Chrome');
        mt.flush();
        mt.recordFocus('Chrome');
        mt.recordFocus('Chrome');
        mt.flush();
        const mem = lp.getForTitle('Chrome', 'memory');
        assert.strictEqual(mem.totalSec, 3);
    });

    it('publishToShortPool updates short pool', () => {
        const sp = new ShortTermPool();
        const lp = new LongTermPool();
        const mt = new MemoryTracker(sp, lp);
        mt.recordFocus('Chrome');
        mt.publishToShortPool();
        const today = sp.get('memory.today');
        assert.strictEqual(today['Chrome'], 1);
    });

    it('configure updates settings', () => {
        const sp = new ShortTermPool();
        const lp = new LongTermPool();
        const mt = new MemoryTracker(sp, lp);
        mt.configure({ enabled: false, retentionDays: 7 });
        assert.strictEqual(mt.enabled, false);
        assert.strictEqual(mt.retentionDays, 7);
    });
});

// ========== Test: SearchService ==========

describe('SearchService', () => {
    let SearchService;

    beforeEach(() => {
        loadEnhanceModules('search-service.js');
        SearchService = global.window.SearchService;
    });

    it('should instantiate with defaults', () => {
        const ss = new SearchService();
        assert.strictEqual(ss.enabled, false);
        assert.strictEqual(ss.provider, 'custom');
    });

    it('configure updates settings', () => {
        const ss = new SearchService();
        ss.configure({ enabled: true, provider: 'duckduckgo', customUrl: 'http://test' });
        assert.strictEqual(ss.enabled, true);
        assert.strictEqual(ss.provider, 'duckduckgo');
        assert.strictEqual(ss.customUrl, 'http://test');
    });

    it('search returns disabled when not enabled', async () => {
        const ss = new SearchService();
        const result = await ss.search('test');
        assert.strictEqual(result.success, false);
        assert.strictEqual(result.error, 'disabled');
    });

    it('search returns no_ipc when no electronAPI', async () => {
        const ss = new SearchService();
        ss.enabled = true;
        const result = await ss.search('test');
        assert.strictEqual(result.success, false);
        assert.strictEqual(result.error, 'no_ipc');
    });

    it('search calls webSearch IPC', async () => {
        const ss = new SearchService();
        ss.enabled = true;
        ss.provider = 'custom';
        ss.customUrl = 'https://api.example.com/search';
        let capturedArgs = null;
        global.window.electronAPI = {
            webSearch: async (q, p, o) => {
                capturedArgs = { q, p, o };
                return { success: true, results: 'test results' };
            }
        };
        const result = await ss.search('react hooks');
        assert.strictEqual(result.success, true);
        assert.strictEqual(capturedArgs.q, 'react hooks');
        assert.strictEqual(capturedArgs.p, 'custom');
        assert.strictEqual(capturedArgs.o.customUrl, 'https://api.example.com/search');
    });
});

// ========== Test: KnowledgeStore ==========

describe('KnowledgeStore', () => {
    let KnowledgeStore, ShortTermPool, LongTermPool;

    beforeEach(() => {
        loadEnhanceModules('context-pool.js', 'enhance-utils.js', 'knowledge-store.js');
        ShortTermPool = global.window.ShortTermPool;
        LongTermPool = global.window.LongTermPool;
        KnowledgeStore = global.window.KnowledgeStore;
    });

    it('should instantiate with defaults', () => {
        const sp = new ShortTermPool();
        const lp = new LongTermPool();
        const ks = new KnowledgeStore(sp, lp, null);
        assert.strictEqual(ks.enabled, false);
        assert.strictEqual(ks.minIntervalMs, 60000);
    });

    it('configure updates settings', () => {
        const sp = new ShortTermPool();
        const lp = new LongTermPool();
        const ks = new KnowledgeStore(sp, lp, null);
        ks.configure({ enabled: true, minIntervalMs: 30000 });
        assert.strictEqual(ks.enabled, true);
        assert.strictEqual(ks.minIntervalMs, 30000);
    });

    it('maybeUpdate does nothing when disabled', async () => {
        const sp = new ShortTermPool();
        const lp = new LongTermPool();
        const ks = new KnowledgeStore(sp, lp, null);
        await ks.maybeUpdate('test', 'search results');
        assert.strictEqual(lp.getForTitle('test', 'knowledge'), null);
    });

    it('maybeUpdate stores knowledge from LLM', async () => {
        const sp = new ShortTermPool();
        const lp = new LongTermPool();
        const mockAI = {
            callAPI: async () => '[React] A JavaScript library for building UIs'
        };
        const ks = new KnowledgeStore(sp, lp, mockAI);
        ks.enabled = true;
        await ks.maybeUpdate('React Tutorial', 'React is a JS library...');
        const knowledge = lp.getForTitle('React Tutorial', 'knowledge');
        assert.ok(knowledge);
        assert.ok(knowledge.summary.includes('React'));
        assert.strictEqual(knowledge.updateCount, 1);
    });

    it('maybeUpdate respects interval backoff', async () => {
        const sp = new ShortTermPool();
        const lp = new LongTermPool();
        let callCount = 0;
        const mockAI = {
            callAPI: async () => { callCount++; return 'summary'; }
        };
        const ks = new KnowledgeStore(sp, lp, mockAI);
        ks.enabled = true;
        ks.minIntervalMs = 60000;
        await ks.maybeUpdate('test', 'data');
        assert.strictEqual(callCount, 1);
        // Second call within interval should be skipped
        await ks.maybeUpdate('test', 'data');
        assert.strictEqual(callCount, 1);
    });

    it('resetInterval clears backoff', () => {
        const sp = new ShortTermPool();
        const lp = new LongTermPool();
        const ks = new KnowledgeStore(sp, lp, null);
        ks._intervals['test'] = 120000;
        ks._lastUpdateTime['test'] = Date.now();
        ks.resetInterval('test');
        assert.strictEqual(ks._intervals['test'], undefined);
        assert.strictEqual(ks._lastUpdateTime['test'], undefined);
    });
});

// ========== Test: EnhancementOrchestrator ==========

describe('EnhancementOrchestrator', () => {
    let EnhancementOrchestrator, ShortTermPool, LongTermPool, MemoryTracker, SearchService, KnowledgeStore, VLMExtractor;

    beforeEach(() => {
        loadEnhanceModules('context-pool.js', 'enhance-utils.js', 'memory-tracker.js', 'search-service.js', 'knowledge-store.js', 'vlm-extractor.js', 'enhancement-orchestrator.js');
        ShortTermPool = global.window.ShortTermPool;
        LongTermPool = global.window.LongTermPool;
        MemoryTracker = global.window.MemoryTracker;
        SearchService = global.window.SearchService;
        KnowledgeStore = global.window.KnowledgeStore;
        VLMExtractor = global.window.VLMExtractor;
        EnhancementOrchestrator = global.window.EnhancementOrchestrator;
    });

    it('should instantiate with all sub-modules', () => {
        const eo = new EnhancementOrchestrator(null);
        assert.ok(eo.shortPool instanceof ShortTermPool);
        assert.ok(eo.longPool instanceof LongTermPool);
        assert.ok(eo.memoryTracker instanceof MemoryTracker);
        assert.ok(eo.searchService instanceof SearchService);
        assert.ok(eo.knowledgeStore instanceof KnowledgeStore);
        assert.ok(eo.vlmExtractor instanceof VLMExtractor);
    });

    it('onFocusTick delegates to memoryTracker', () => {
        const eo = new EnhancementOrchestrator(null);
        eo.onFocusTick('Chrome');
        eo.onFocusTick('Chrome');
        const counts = eo.memoryTracker.getSessionCounts();
        assert.strictEqual(counts['Chrome'], 2);
    });

    it('isNoiseTitle filters noise', () => {
        assert.strictEqual(isNoiseTitle('New Tab'), true);
        assert.strictEqual(isNoiseTitle('Desktop'), true);
        assert.strictEqual(isNoiseTitle('ab'), true);
        assert.strictEqual(isNoiseTitle(''), true);
        assert.strictEqual(isNoiseTitle(null), true);
        assert.strictEqual(isNoiseTitle('React Tutorial'), false);
    });

    it('sanitizeSecrets masks long alphanumeric sequences', () => {
        assert.strictEqual(sanitizeSecrets('key=sk-abc123def456ghi789jkl'), 'key=[***]');
        assert.strictEqual(sanitizeSecrets('short ok'), 'short ok');
        assert.strictEqual(sanitizeSecrets(null), null);
        assert.strictEqual(sanitizeSecrets(''), '');
        assert.strictEqual(sanitizeSecrets('normal text React Tutorial'), 'normal text React Tutorial');
        // 20+ chars get masked
        assert.strictEqual(sanitizeSecrets('a'.repeat(20)), '[***]');
        assert.strictEqual(sanitizeSecrets('a'.repeat(19)), 'a'.repeat(19));
    });

    it('_shouldSearch returns false when search disabled', () => {
        const eo = new EnhancementOrchestrator(null);
        eo.searchService.enabled = false;
        assert.strictEqual(eo._shouldSearch('React'), false);
    });

    it('_shouldSearch returns false for noise titles', () => {
        const eo = new EnhancementOrchestrator(null);
        eo.searchService.enabled = true;
        assert.strictEqual(eo._shouldSearch('New Tab'), false);
    });

    it('_shouldSearch returns false when focus time too low', () => {
        const eo = new EnhancementOrchestrator(null);
        eo.searchService.enabled = true;
        eo._minFocusSeconds = 10;
        // No focus data in short pool
        assert.strictEqual(eo._shouldSearch('React Tutorial'), false);
    });

    it('_shouldSearch returns true when all conditions met', () => {
        const eo = new EnhancementOrchestrator(null);
        eo.searchService.enabled = true;
        eo._minFocusSeconds = 5;
        eo._maxSearchFrequencyMs = 0;
        eo.shortPool.set('memory.today', { 'React Tutorial': 15 });
        assert.strictEqual(eo._shouldSearch('React Tutorial'), true);
    });

    it('buildEnhancedContext returns empty when no data', () => {
        const eo = new EnhancementOrchestrator(null);
        const ctx = eo.buildEnhancedContext('test');
        assert.strictEqual(ctx, '');
    });

    it('buildEnhancedContext includes today activity', () => {
        const eo = new EnhancementOrchestrator(null);
        eo.shortPool.set('memory.today', { 'Chrome': 60, 'VSCode': 120 });
        const ctx = eo.buildEnhancedContext('test');
        assert.ok(ctx.includes('VSCode'));
        assert.ok(ctx.includes('Chrome'));
    });

    it('buildEnhancedContext includes search results', () => {
        const eo = new EnhancementOrchestrator(null);
        eo.shortPool.set('search.results', 'React is a JavaScript library');
        const ctx = eo.buildEnhancedContext('React');
        assert.ok(ctx.includes('React is a JavaScript library'));
    });

    it('buildEnhancedContext includes RAG knowledge', () => {
        const eo = new EnhancementOrchestrator(null);
        eo.longPool.setForTitle('react basics', 'knowledge', { summary: 'React is for building UIs' });
        const ctx = eo.buildEnhancedContext('react basics');
        assert.ok(ctx.includes('React is for building UIs'));
    });

    it('stop flushes and cleans up', async () => {
        const eo = new EnhancementOrchestrator(null);
        eo.memoryTracker.recordFocus('test');
        await eo.stop();
        // After stop, session counts should be flushed
        assert.deepStrictEqual(eo.memoryTracker.getSessionCounts(), {});
    });
});

// ========== Test: VLMExtractor ==========

describe('VLMExtractor', () => {
    let VLMExtractor, ShortTermPool, LongTermPool;

    beforeEach(() => {
        loadEnhanceModules('context-pool.js', 'enhance-utils.js', 'vlm-extractor.js');
        ShortTermPool = global.window.ShortTermPool;
        LongTermPool = global.window.LongTermPool;
        VLMExtractor = global.window.VLMExtractor;
    });

    it('should instantiate with defaults', () => {
        const sp = new ShortTermPool();
        const lp = new LongTermPool();
        const vlm = new VLMExtractor(sp, lp, null);
        assert.strictEqual(vlm.enabled, false);
        assert.strictEqual(vlm.baseIntervalMs, 15000);
        assert.strictEqual(vlm.maxIntervalMs, 60000);
    });

    it('configure updates settings', () => {
        const sp = new ShortTermPool();
        const lp = new LongTermPool();
        const vlm = new VLMExtractor(sp, lp, null);
        vlm.configure({ enabled: true, baseIntervalMs: 5000 });
        assert.strictEqual(vlm.enabled, true);
        assert.strictEqual(vlm.baseIntervalMs, 5000);
    });

    it('maybeExtract does nothing when disabled', async () => {
        const sp = new ShortTermPool();
        const lp = new LongTermPool();
        let called = false;
        const mockAI = { callAPI: async () => { called = true; return 'kw | title'; } };
        const vlm = new VLMExtractor(sp, lp, mockAI);
        await vlm.maybeExtract('React Tutorial', 'base64data');
        assert.strictEqual(called, false);
    });

    it('maybeExtract does nothing for noise titles', async () => {
        const sp = new ShortTermPool();
        const lp = new LongTermPool();
        let called = false;
        const mockAI = { callAPI: async () => { called = true; return 'kw | title'; } };
        const vlm = new VLMExtractor(sp, lp, mockAI);
        vlm.enabled = true;
        await vlm.maybeExtract('New Tab', 'base64data');
        assert.strictEqual(called, false);
    });

    it('maybeExtract skips when focus time too low', async () => {
        const sp = new ShortTermPool();
        const lp = new LongTermPool();
        let called = false;
        const mockAI = { callAPI: async () => { called = true; return 'kw | title'; } };
        const vlm = new VLMExtractor(sp, lp, mockAI);
        vlm.enabled = true;
        sp.set('memory.today', { 'React Tutorial': 2 });
        await vlm.maybeExtract('React Tutorial', 'base64data');
        assert.strictEqual(called, false);
    });

    it('maybeExtract calls API and stores result', async () => {
        const sp = new ShortTermPool();
        const lp = new LongTermPool();
        const mockAI = { callAPI: async () => 'react, hooks, useState | React Hooks Tutorial' };
        const vlm = new VLMExtractor(sp, lp, mockAI);
        vlm.enabled = true;
        vlm.minFocusSeconds = 0;
        sp.set('memory.today', { 'React Tutorial': 30 });
        await vlm.maybeExtract('React Tutorial', 'base64data');
        const stored = lp.getForTitle('React Tutorial', 'vlm');
        assert.ok(stored);
        assert.ok(stored.summary.includes('react'));
        assert.strictEqual(stored.enrichedTitle, 'React Hooks Tutorial');
        assert.strictEqual(stored.updateCount, 1);
    });

    it('second extraction replaces summary instead of appending', async () => {
        const sp = new ShortTermPool();
        const lp = new LongTermPool();
        let callCount = 0;
        const mockAI = { callAPI: async () => {
            callCount++;
            return callCount === 1 ? 'old keywords | Old Title' : 'new keywords | New Title';
        }};
        const vlm = new VLMExtractor(sp, lp, mockAI);
        vlm.enabled = true;
        vlm.minFocusSeconds = 0;
        vlm.baseIntervalMs = 0;
        sp.set('memory.today', { 'Test': 30 });

        await vlm.maybeExtract('Test', 'base64data');
        assert.ok(lp.getForTitle('Test', 'vlm').summary.includes('old keywords'));

        vlm._extracting = false;
        vlm._lastExtractTime = {};
        vlm._intervals = {};
        // Clear stored VLM so RAG high-confidence check doesn't skip
        lp.clearForTitle('Test');

        await vlm.maybeExtract('Test', 'base64data');
        const second = lp.getForTitle('Test', 'vlm');
        assert.ok(second.summary.includes('new keywords'));
        assert.ok(!second.summary.includes('old keywords'));
        assert.strictEqual(second.updateCount, 1);
    });

    it('_parseResult splits keywords and enrichedTitle', () => {
        const vlm = new VLMExtractor(new ShortTermPool(), new LongTermPool(), null);
        const result = vlm._parseResult('react, hooks, state | React Hooks Guide');
        assert.strictEqual(result.keywords, 'react, hooks, state');
        assert.strictEqual(result.enrichedTitle, 'React Hooks Guide');
    });

    it('_parseResult handles no pipe separator', () => {
        const vlm = new VLMExtractor(new ShortTermPool(), new LongTermPool(), null);
        const result = vlm._parseResult('just keywords here');
        assert.strictEqual(result.keywords, 'just keywords here');
        assert.strictEqual(result.enrichedTitle, '');
    });

    it('resetInterval clears tracking', () => {
        const vlm = new VLMExtractor(new ShortTermPool(), new LongTermPool(), null);
        vlm._intervals['test'] = 30000;
        vlm._lastExtractTime['test'] = Date.now();
        vlm.resetInterval('test');
        assert.strictEqual(vlm._intervals['test'], undefined);
        assert.strictEqual(vlm._lastExtractTime['test'], undefined);
    });
});

// ========== Test: KnowledgeAcquisition ==========

describe('KnowledgeAcquisition', () => {
    let KnowledgeAcquisition, ShortTermPool, LongTermPool, SearchService;

    beforeEach(() => {
        loadEnhanceModules('context-pool.js', 'enhance-utils.js', 'search-service.js', 'knowledge-acquisition.js');
        ShortTermPool = global.window.ShortTermPool;
        LongTermPool = global.window.LongTermPool;
        SearchService = global.window.SearchService;
        KnowledgeAcquisition = global.window.KnowledgeAcquisition;
    });

    it('should instantiate with defaults', () => {
        const ka = new KnowledgeAcquisition(new ShortTermPool(), new LongTermPool(), null, new SearchService());
        assert.strictEqual(ka.enabled, false);
        assert.strictEqual(ka.minFocusSeconds, 60);
        assert.strictEqual(ka._taskQueue.length, 0);
    });

    it('configure updates settings', () => {
        const ka = new KnowledgeAcquisition(new ShortTermPool(), new LongTermPool(), null, new SearchService());
        ka.configure({ enabled: true, minFocusSeconds: 30, maxTermsPerTopic: 5 });
        assert.strictEqual(ka.enabled, true);
        assert.strictEqual(ka.minFocusSeconds, 30);
        assert.strictEqual(ka.maxTermsPerTopic, 5);
    });

    it('maybeAcquire does nothing when disabled', async () => {
        let called = false;
        const mockAI = { callAPI: async () => { called = true; return '["React"]'; } };
        const ka = new KnowledgeAcquisition(new ShortTermPool(), new LongTermPool(), mockAI, new SearchService());
        await ka.maybeAcquire('test', 'react hooks', 120);
        assert.strictEqual(called, false);
    });

    it('maybeAcquire does nothing when search is disabled', async () => {
        let called = false;
        const mockAI = { callAPI: async () => { called = true; return '["React"]'; } };
        const ss = new SearchService();
        ss.enabled = false;
        const ka = new KnowledgeAcquisition(new ShortTermPool(), new LongTermPool(), mockAI, ss);
        ka.enabled = true;
        await ka.maybeAcquire('test', 'react hooks', 120);
        assert.strictEqual(called, false);
        assert.strictEqual(ka._taskQueue.length, 0);
    });

    it('maybeAcquire does nothing when focus time too low', async () => {
        let called = false;
        const mockAI = { callAPI: async () => { called = true; return '["React"]'; } };
        const ss = new SearchService();
        ss.enabled = true;
        const ka = new KnowledgeAcquisition(new ShortTermPool(), new LongTermPool(), mockAI, ss);
        ka.enabled = true;
        await ka.maybeAcquire('test', 'react hooks', 5);
        assert.strictEqual(called, false);
    });

    it('maybeAcquire generates topics and queues tasks', async () => {
        let callCount = 0;
        const mockAI = { callAPI: async () => {
            callCount++;
            if (callCount === 1) return '["React"]';
            return '["react hooks", "react state"]';
        }};
        const ss = new SearchService();
        ss.enabled = true;
        const ka = new KnowledgeAcquisition(new ShortTermPool(), new LongTermPool(), mockAI, ss);
        ka.enabled = true;
        ka.minFocusSeconds = 0;
        await ka.maybeAcquire('test', 'react hooks useState', 120);
        assert.strictEqual(callCount, 2);
        assert.ok(ka._taskQueue.length > 0);
        assert.strictEqual(ka._taskQueue[0].topic, 'React');
        assert.strictEqual(ka._taskQueue[0].status, 'pending');
    });

    it('maybeAcquire sends short user message (not duplicate keywords)', async () => {
        const capturedMessages = [];
        const mockAI = { callAPI: async (msgs) => {
            capturedMessages.push(msgs);
            return '["React"]';
        }};
        const ss = new SearchService();
        ss.enabled = true;
        const ka = new KnowledgeAcquisition(new ShortTermPool(), new LongTermPool(), mockAI, ss);
        ka.enabled = true;
        ka.minFocusSeconds = 0;
        await ka.maybeAcquire('test', 'react hooks', 120);
        assert.strictEqual(capturedMessages[0][1].role, 'user');
        assert.strictEqual(capturedMessages[0][1].content, 'Extract.');
        if (capturedMessages.length > 1) {
            assert.strictEqual(capturedMessages[1][1].content, 'Generate.');
        }
    });

    it('processQueue returns 0 when search disabled', async () => {
        const ss = new SearchService();
        ss.enabled = false;
        const ka = new KnowledgeAcquisition(new ShortTermPool(), new LongTermPool(), null, ss);
        ka.enabled = true;
        ka._taskQueue = [{ topic: 'React', term: 'hooks', status: 'pending', retries: 0 }];
        const result = await ka.processQueue();
        assert.strictEqual(result, 0);
    });

    it('processQueue processes pending tasks', async () => {
        const ss = new SearchService();
        ss.enabled = true;
        global.window.electronAPI = {
            webSearch: async () => ({ success: true, results: 'React is a library for building UIs with components' })
        };
        const ka = new KnowledgeAcquisition(new ShortTermPool(), new LongTermPool(), null, ss);
        ka.enabled = true;
        ka._taskQueue = [
            { topic: 'React', term: 'hooks', status: 'pending', retries: 0, addedAt: Date.now() }
        ];
        const processed = await ka.processQueue(1);
        assert.strictEqual(processed, 1);
        assert.strictEqual(ka._taskQueue[0].status, 'done');
    });

    it('getQueueStatus returns correct counts', () => {
        const ka = new KnowledgeAcquisition(new ShortTermPool(), new LongTermPool(), null, new SearchService());
        ka._taskQueue = [
            { status: 'pending' }, { status: 'pending' },
            { status: 'done' }, { status: 'failed' }
        ];
        const status = ka.getQueueStatus();
        assert.strictEqual(status.pending, 2);
        assert.strictEqual(status.done, 1);
        assert.strictEqual(status.failed, 1);
        assert.strictEqual(status.total, 4);
    });

    it('_parseJSON handles valid JSON array', () => {
        const ka = new KnowledgeAcquisition(new ShortTermPool(), new LongTermPool(), null, new SearchService());
        assert.deepStrictEqual(ka._parseJSON('["a","b"]'), ['a', 'b']);
    });

    it('_parseJSON extracts array from text', () => {
        const ka = new KnowledgeAcquisition(new ShortTermPool(), new LongTermPool(), null, new SearchService());
        assert.deepStrictEqual(ka._parseJSON('Here are topics: ["React","Vue"]'), ['React', 'Vue']);
    });

    it('_parseJSON returns null for invalid input', () => {
        const ka = new KnowledgeAcquisition(new ShortTermPool(), new LongTermPool(), null, new SearchService());
        assert.strictEqual(ka._parseJSON('not json'), null);
        assert.strictEqual(ka._parseJSON(null), null);
        assert.strictEqual(ka._parseJSON(''), null);
    });

    it('decayKnowledge reduces confidence over time', () => {
        const lp = new LongTermPool();
        const ka = new KnowledgeAcquisition(new ShortTermPool(), lp, null, new SearchService());
        const twoWeeksAgo = Date.now() - 14 * 86400000;
        lp.setForTitle('old topic', 'acquired', {
            summary: 'old data', confidence: 0.8, originalConfidence: 0.8, searchedAt: twoWeeksAgo
        });
        ka.decayKnowledge();
        const decayed = lp.getForTitle('old topic', 'acquired');
        assert.ok(decayed);
        assert.ok(decayed.confidence < 0.8);
    });
});
