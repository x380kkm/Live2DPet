/**
 * VLM Extractor — Extract keywords/summaries from screenshots via vision LLM
 * Also enriches window titles with more descriptive content
 * Frequency: exponential backoff per-title, only for focused window
 */
class VLMExtractor {
    constructor(shortPool, longPool, aiClient) {
        this.shortPool = shortPool;
        this.longPool = longPool;
        this.aiClient = aiClient;
        this.enabled = false;
        this.baseIntervalMs = 15000;
        this.maxIntervalMs = 60000;
        this.minFocusSeconds = 10;
        this._lastExtractTime = {};
        this._intervals = {};
        this._extracting = false;
    }

    configure(config) {
        if (config.enabled !== undefined) this.enabled = config.enabled;
        if (config.baseIntervalMs) this.baseIntervalMs = config.baseIntervalMs;
        if (config.maxIntervalMs) this.maxIntervalMs = config.maxIntervalMs;
        if (config.minFocusSeconds) this.minFocusSeconds = config.minFocusSeconds;
    }

    /**
     * Main entry — called fire-and-forget by orchestrator
     * @param {string} title - current focused window title
     * @param {string|null} screenshotBase64 - latest screenshot
     */
    async maybeExtract(title, screenshotBase64) {
        if (!this.enabled || !title || !screenshotBase64 || !this.aiClient) return;
        if (this._extracting) return;
        if (isNoiseTitle(title)) return;

        const focusTime = this.shortPool.get('memory.today')?.[title] || 0;
        if (focusTime < this.minFocusSeconds) return;

        const now = Date.now();
        const lastExtract = this._lastExtractTime[title] || 0;
        const interval = this._intervals[title] || this.baseIntervalMs;
        if (now - lastExtract < interval) return;

        const existing = this.longPool.query(title, { layer: 'vlm', maxResults: 1 });
        if (existing.length > 0 && existing[0].confidence > 0.8) {
            this._intervals[title] = Math.min((interval || this.baseIntervalMs) * 2, this.maxIntervalMs);
            this._lastExtractTime[title] = now;
            return;
        }

        this._extracting = true;
        try {
            const messages = [
                {
                    role: 'system',
                    content: enhanceT('sys.vlmPrompt').replace('{0}', enhanceLangName())
                },
                {
                    role: 'user',
                    content: [
                        { type: 'text', text: `Window: ${title}` },
                        { type: 'image_url', image_url: { url: 'data:image/jpeg;base64,' + screenshotBase64 } }
                    ]
                }
            ];

            const result = await this.aiClient.callAPI(messages);
            if (result) {
                const parsed = this._parseResult(result);
                const existingVlm = this.longPool.getForTitle(title, 'vlm') || { updateCount: 0 };

                this.longPool.setForTitle(title, 'vlm', {
                    summary: parsed.keywords.slice(0, 200),
                    enrichedTitle: parsed.enrichedTitle || title,
                    lastUpdated: now,
                    updateCount: existingVlm.updateCount + 1
                });

                this.shortPool.set('vlm.enrichedTitle', parsed.enrichedTitle || title);
                console.log(`[Enhance:VLM] Extracted for "${title}": ${result.slice(0, 80)}`);
            }

            this._intervals[title] = Math.min((interval || this.baseIntervalMs) * 2, this.maxIntervalMs);
        } catch (e) {
            this._intervals[title] = Math.min((this._intervals[title] || this.baseIntervalMs) * 2, this.maxIntervalMs);
            console.warn(`[Enhance:VLM] Failed for "${title}":`, e.message);
        } finally {
            this._lastExtractTime[title] = now;
            this._extracting = false;
            this._pruneCache();
        }
    }

    _parseResult(result) {
        let keywords = result;
        let enrichedTitle = '';
        const pipeIdx = result.indexOf('|');
        if (pipeIdx !== -1) {
            const left = result.slice(0, pipeIdx).trim();
            const right = result.slice(pipeIdx + 1).trim();
            keywords = left.replace(/^keywords:\s*/i, '').trim();
            enrichedTitle = right.replace(/^title:\s*/i, '').trim();
        }
        return { keywords: keywords.slice(0, 150), enrichedTitle: enrichedTitle.slice(0, 80) };
    }

    resetInterval(title) {
        delete this._intervals[title];
        delete this._lastExtractTime[title];
    }

    /** Cap internal maps to prevent unbounded growth */
    _pruneCache(maxEntries = 100) {
        const keys = Object.keys(this._lastExtractTime);
        if (keys.length <= maxEntries) return;
        const sorted = keys.sort((a, b) => (this._lastExtractTime[a] || 0) - (this._lastExtractTime[b] || 0));
        for (let i = 0; i < sorted.length - maxEntries; i++) {
            delete this._lastExtractTime[sorted[i]];
            delete this._intervals[sorted[i]];
        }
    }
}

if (typeof window !== 'undefined') window.VLMExtractor = VLMExtractor;
