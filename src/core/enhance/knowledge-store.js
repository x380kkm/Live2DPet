/**
 * Knowledge Store — LLM-organized knowledge per title
 * Uses exponential backoff, per-title isolation, RAG-driven updates
 */
class KnowledgeStore {
    constructor(shortPool, longPool, aiClient) {
        this.shortPool = shortPool;
        this.longPool = longPool;
        this.aiClient = aiClient;
        this.enabled = false;
        this.minIntervalMs = 60000;
        this.maxIntervalMs = 3600000;
        this._lastUpdateTime = {};  // {title: timestamp}
        this._intervals = {};       // {title: currentIntervalMs}
    }

    configure(config) {
        if (config.enabled !== undefined) this.enabled = config.enabled;
        if (config.minIntervalMs) this.minIntervalMs = config.minIntervalMs;
        if (config.maxIntervalMs) this.maxIntervalMs = config.maxIntervalMs;
    }

    async maybeUpdate(title, searchResults) {
        if (!this.enabled || !title || !this.aiClient) return;

        const now = Date.now();
        const lastUpdate = this._lastUpdateTime[title] || 0;
        const interval = this._intervals[title] || this.minIntervalMs;

        if (now - lastUpdate < interval) return;

        // Check RAG for existing high-confidence knowledge
        const existing = this.longPool.query(title, { layer: 'knowledge', maxResults: 1 });
        if (existing.length > 0 && existing[0].confidence > 0.7) {
            // High confidence match — use existing, increase backoff
            this._intervals[title] = Math.min(interval * 2, this.maxIntervalMs);
            this._lastUpdateTime[title] = now;
            return;
        }

        // Need search results to organize
        if (!searchResults) return;

        try {
            // Build RAG context from related knowledge
            const ragHits = this.longPool.query(title, { layer: 'knowledge', maxResults: 3, minConfidence: 0.3 });
            const ragContext = ragHits.map(h => `${h.title}: ${h.data.summary}`).join('\n');

            const messages = [
                { role: 'system', content: enhanceT('sys.knowledgePrompt').replace('{0}', enhanceLangName()) },
                { role: 'user', content: `Window: ${title}\nSearch: ${searchResults}${ragContext ? '\nRelated knowledge: ' + ragContext : ''}` }
            ];

            const summary = await this.aiClient.callAPI(messages);
            if (summary) {
                const existingKnowledge = this.longPool.getForTitle(title, 'knowledge') || { updateCount: 0 };
                this.longPool.setForTitle(title, 'knowledge', {
                    summary: summary.slice(0, 200),
                    lastUpdated: now,
                    updateCount: existingKnowledge.updateCount + 1,
                    currentInterval: interval
                });
                this._intervals[title] = Math.min(interval * 2, this.maxIntervalMs);
                console.log(`[Enhance:Knowledge] Updated for: ${title}`);
            }
        } catch (e) {
            // API failure — increase backoff
            this._intervals[title] = Math.min((interval || this.minIntervalMs) * 2, this.maxIntervalMs);
            console.warn(`[Enhance:Knowledge] Failed for ${title}:`, e.message);
        }

        this._lastUpdateTime[title] = now;
        this._pruneCache();
    }

    resetInterval(title) {
        delete this._intervals[title];
        delete this._lastUpdateTime[title];
    }

    /** Cap internal maps to prevent unbounded growth */
    _pruneCache(maxEntries = 100) {
        const keys = Object.keys(this._lastUpdateTime);
        if (keys.length <= maxEntries) return;
        const sorted = keys.sort((a, b) => (this._lastUpdateTime[a] || 0) - (this._lastUpdateTime[b] || 0));
        for (let i = 0; i < sorted.length - maxEntries; i++) {
            delete this._lastUpdateTime[sorted[i]];
            delete this._intervals[sorted[i]];
        }
    }
}

if (typeof window !== 'undefined') window.KnowledgeStore = KnowledgeStore;
