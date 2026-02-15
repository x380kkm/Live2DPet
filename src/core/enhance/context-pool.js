/**
 * Context Pool — Layered state management for enhancement system
 * ShortTermPool: in-memory, session-scoped
 * LongTermPool: persistent, per-title isolated, with lightweight RAG
 */

const STOP_WORDS = new Set(['the','a','an','is','in','on','at','to','for','of','and','or',
  'new','tab','page','untitled','的','了','在','是','我','你','他','this','that','it',
  'microsoft','edge','chrome','firefox','个人','personal','页面','另外','和',
  '個人用','件','ページ','その他','タブ']);

class ShortTermPool {
    constructor() { this._store = {}; }

    set(key, value) {
        this._store[key] = { value, updatedAt: Date.now() };
    }

    get(key) { return this._store[key]?.value ?? null; }

    getAge(key) {
        return this._store[key] ? Date.now() - this._store[key].updatedAt : Infinity;
    }

    has(key) { return key in this._store; }
    delete(key) { delete this._store[key]; }
    clear() { this._store = {}; }

    prune(maxEntries = 50) {
        const entries = Object.entries(this._store);
        if (entries.length <= maxEntries) return;
        entries.sort((a, b) => a[1].updatedAt - b[1].updatedAt);
        const toRemove = entries.length - maxEntries;
        for (let i = 0; i < toRemove; i++) {
            delete this._store[entries[i][0]];
        }
    }
}

class LongTermPool {
    constructor() {
        this._titles = {};
        this._dirty = false;
        this._flushing = false;
    }

    setForTitle(normalizedTitle, layer, value) {
        if (value === null || value === undefined) {
            if (this._titles[normalizedTitle]) {
                delete this._titles[normalizedTitle][layer];
                if (Object.keys(this._titles[normalizedTitle]).length === 0) {
                    delete this._titles[normalizedTitle];
                }
            }
            this._dirty = true;
            return;
        }
        if (!this._titles[normalizedTitle]) this._titles[normalizedTitle] = {};
        this._titles[normalizedTitle][layer] = value;
        this._dirty = true;
    }

    getForTitle(normalizedTitle, layer) {
        return this._titles[normalizedTitle]?.[layer] ?? null;
    }

    query(currentTitle, options = {}) {
        const { layer, maxResults = 5, minConfidence = 0.2 } = options;
        const currentTokens = this._tokenize(currentTitle);
        if (currentTokens.length === 0) return [];
        const results = [];
        for (const [storedTitle, data] of Object.entries(this._titles)) {
            const storedTokens = this._enrichTokens(storedTitle, data);
            const confidence = this._jaccardSimilarity(currentTokens, storedTokens);
            if (confidence >= minConfidence) {
                const entry = layer ? data[layer] : data;
                if (entry) results.push({ title: storedTitle, confidence, data: entry });
            }
        }
        return results
            .sort((a, b) => b.confidence - a.confidence)
            .slice(0, maxResults);
    }

    /** Combine title tokens with VLM keywords for richer matching */
    _enrichTokens(title, data) {
        const tokens = this._tokenize(title);
        const vlm = data?.vlm;
        if (vlm?.summary) {
            const kwTokens = vlm.summary.toLowerCase()
                .split(/[,|;，；\s]+/)
                .map(s => s.trim())
                .filter(w => w.length > 1 && !STOP_WORDS.has(w));
            for (const t of kwTokens) {
                if (!tokens.includes(t)) tokens.push(t);
            }
        }
        if (vlm?.enrichedTitle) {
            for (const t of this._tokenize(vlm.enrichedTitle)) {
                if (!tokens.includes(t)) tokens.push(t);
            }
        }
        return tokens;
    }

    _tokenize(title) {
        return tokenizeTitle(title);
    }

    _jaccardSimilarity(a, b) {
        const setA = new Set(a), setB = new Set(b);
        const intersection = [...setA].filter(x => setB.has(x)).length;
        const union = new Set([...setA, ...setB]).size;
        return union === 0 ? 0 : intersection / union;
    }

    async load() {
        try {
            if (window.electronAPI?.loadEnhanceData) {
                const result = await window.electronAPI.loadEnhanceData();
                if (result.success && result.data) {
                    this._titles = result.data;
                }
            }
        } catch (e) {
            console.warn('[Enhance:Pool] Failed to load:', e.message);
        }
    }

    async flush() {
        if (!this._dirty || this._flushing) return;
        this._flushing = true;
        this.prune();
        try {
            if (window.electronAPI?.saveEnhanceData) {
                await window.electronAPI.saveEnhanceData(this._titles);
                this._dirty = false;
            }
        } catch (e) {
            console.warn('[Enhance:Pool] Failed to flush:', e.message);
        } finally {
            this._flushing = false;
        }
    }

    clearForTitle(normalizedTitle) {
        delete this._titles[normalizedTitle];
        this._dirty = true;
    }

    prune(maxTitles = 200) {
        const titles = Object.keys(this._titles);
        if (titles.length <= maxTitles) return;
        const scored = titles
            .filter(t => !t.startsWith('__'))
            .map(title => {
                const mem = this._titles[title]?.memory;
                return { title, lastSeen: mem?.lastSeen || '1970-01-01' };
            });
        scored.sort((a, b) => a.lastSeen.localeCompare(b.lastSeen));
        const toRemove = titles.length - maxTitles;
        for (let i = 0; i < toRemove && i < scored.length; i++) {
            delete this._titles[scored[i].title];
        }
        this._dirty = true;
    }

    get isDirty() { return this._dirty; }
    get titleCount() { return Object.keys(this._titles).length; }
    getAllTitles() { return Object.keys(this._titles); }
}

if (typeof window !== 'undefined') {
    window.ShortTermPool = ShortTermPool;
    window.LongTermPool = LongTermPool;
    window.STOP_WORDS = STOP_WORDS;
}
