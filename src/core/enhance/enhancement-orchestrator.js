/**
 * Enhancement Orchestrator — Coordinates memory, search, knowledge layers
 * Importance evaluation, frequency control, context building
 */
class EnhancementOrchestrator {
    constructor(aiClient) {
        this.aiClient = aiClient;
        this.shortPool = new ShortTermPool();
        this.longPool = new LongTermPool();
        this.memoryTracker = new MemoryTracker(this.shortPool, this.longPool);
        this.searchService = new SearchService();
        this.knowledgeStore = new KnowledgeStore(this.shortPool, this.longPool, aiClient);
        this.vlmExtractor = new VLMExtractor(this.shortPool, this.longPool, aiClient);
        this.knowledgeAcq = typeof KnowledgeAcquisition !== 'undefined'
            ? new KnowledgeAcquisition(this.shortPool, this.longPool, aiClient, this.searchService)
            : null;

        this._lastSearchTime = 0;
        this._maxSearchFrequencyMs = 30000;
        this._minFocusSeconds = 10;
        this._lastTitle = null;
    }

    async init() {
        try {
            if (window.electronAPI?.loadConfig) {
                const config = await window.electronAPI.loadConfig();
                const enhance = config.enhance || {};
                this.memoryTracker.configure(enhance.memory || {});
                this.searchService.configure(enhance.search || {});
                this.knowledgeStore.configure(enhance.knowledge || {});
                this.vlmExtractor.configure(enhance.vlm || {});
                if (this.knowledgeAcq) this.knowledgeAcq.configure(enhance.knowledgeAcq || {});
                this._maxSearchFrequencyMs = enhance.search?.maxFrequencyMs || 30000;
                this._minFocusSeconds = enhance.search?.minFocusSeconds || 10;
            }
            await this.longPool.load();
            if (this.knowledgeAcq) await this.knowledgeAcq.init();
            this.memoryTracker.start();
            console.log('[Enhance:Orchestrator] Initialized');
        } catch (e) {
            console.warn('[Enhance:Orchestrator] Init error:', e.message);
        }
    }

    onFocusTick(title) {
        this.memoryTracker.recordFocus(title);
    }

    async beforeRequest(title, screenshotBase64 = null) {
        if (!title) return '';

        // Clear stale short-pool data when window changes
        if (this._lastTitle && this._lastTitle !== title) {
            this.shortPool.delete('vlm.enrichedTitle');
            if (!this._titlesRelated(this.shortPool.get('search.lastQuery') || '', title)) {
                this.shortPool.delete('search.results');
                this.shortPool.delete('search.lastQuery');
            }
        }

        // Publish current session data to short pool
        this.memoryTracker.publishToShortPool();

        const todayData = this.shortPool.get('memory.today');
        const focusTime = todayData?.[title] || 0;
        console.log(`[Enhance:Orchestrator] beforeRequest: "${title}", focusTime=${focusTime}s, searchEnabled=${this.searchService.enabled}, knowledgeEnabled=${this.knowledgeStore.enabled}`);

        // Sanitize title before external use (strip potential keys/tokens)
        const safeTitle = sanitizeSecrets(title);

        // Evaluate importance and maybe trigger search
        if (this._shouldSearch(title)) {
            console.log(`[Enhance:Orchestrator] Triggering search for: ${safeTitle}`);
            const result = await this.searchService.search(safeTitle);
            if (result.success) {
                this.shortPool.set('search.results', result.results);
                this.shortPool.set('search.lastQuery', title);
                this._lastSearchTime = Date.now();

                // Cache search results in LongTermPool for future RAG retrieval
                this.longPool.setForTitle(title, 'search', {
                    results: result.results.slice(0, 500),
                    cachedAt: Date.now()
                });

                // Update knowledge with fresh search results for THIS title
                await this.knowledgeStore.maybeUpdate(title, result.results);
            }
        } else if (this._lastTitle !== title) {
            // Title changed — only pass search results if they were for a similar title
            const lastQuery = this.shortPool.get('search.lastQuery');
            const cachedResults = this.shortPool.get('search.results');
            if (cachedResults && lastQuery && this._titlesRelated(lastQuery, title)) {
                await this.knowledgeStore.maybeUpdate(title, cachedResults);
            }
        }

        this._lastTitle = title;

        // VLM extraction — fire-and-forget, non-blocking
        if (screenshotBase64) {
            this.vlmExtractor.maybeExtract(title, screenshotBase64).catch(e => {
                console.warn('[Enhance:Orchestrator] VLM extract error:', e.message);
            });
        }

        // Knowledge acquisition — fire-and-forget, non-blocking
        if (this.knowledgeAcq?.enabled) {
            const vlmData = this.longPool.getForTitle(title, 'vlm');
            const vlmKeywords = vlmData?.summary || '';
            const focusTime = this.shortPool.get('memory.today')?.[title] || 0;
            if (vlmKeywords && focusTime >= this.knowledgeAcq.minFocusSeconds) {
                this.knowledgeAcq.maybeAcquire(title, vlmKeywords, focusTime).catch(e =>
                    console.warn('[Enhance:KBAcq] error:', e.message));
            }
            this.knowledgeAcq.processQueue(2).catch(e =>
                console.warn('[Enhance:KBAcq] queue error:', e.message));
        }

        // Flush long pool periodically
        if (this.longPool.isDirty) {
            await this.longPool.flush();
        }

        return this.buildEnhancedContext(title);
    }

    _shouldSearch(title) {
        if (!this.searchService.enabled) return false;
        if (Date.now() - this._lastSearchTime < this._maxSearchFrequencyMs) return false;
        if (isNoiseTitle(title)) return false;
        const focusTime = this.shortPool.get('memory.today')?.[title] || 0;
        if (focusTime < this._minFocusSeconds) return false;
        if (title === this.shortPool.get('search.lastQuery')) return false;
        const existing = this.longPool.query(title, { layer: 'knowledge', maxResults: 1 });
        if (existing.length > 0 && existing[0].confidence > 0.7) return false;
        return true;
    }

    _titlesRelated(titleA, titleB) {
        if (!titleA || !titleB) return false;
        const tokensA = tokenizeTitle(titleA);
        const tokensB = tokenizeTitle(titleB);
        if (tokensA.length === 0 || tokensB.length === 0) return false;
        const setA = new Set(tokensA), setB = new Set(tokensB);
        const intersection = [...setA].filter(x => setB.has(x)).length;
        const union = new Set([...setA, ...setB]).size;
        return union > 0 && (intersection / union) >= 0.3;
    }

    buildEnhancedContext(title) {
        const TOTAL_BUDGET = 2500;
        const sections = [];

        // Priority 1: VLM enriched title (Screen Content — most relevant)
        const enrichedTitle = this.shortPool.get('vlm.enrichedTitle');
        if (enrichedTitle) {
            sections.push({ priority: 1, label: enhanceT('sys.screenContent'), text: enrichedTitle });
        } else {
            // Fallback: check LongTermPool vlm layer for persisted enriched title
            const vlmHits = this.longPool.query(title, { layer: 'vlm', maxResults: 1, minConfidence: 0.5 });
            if (vlmHits.length > 0 && vlmHits[0].data.enrichedTitle) {
                sections.push({ priority: 1, label: enhanceT('sys.screenContent'), text: vlmHits[0].data.enrichedTitle });
            }
        }

        // Priority 2: Today's activity
        const today = this.shortPool.get('memory.today');
        if (today && Object.keys(today).length > 0) {
            const top = Object.entries(today)
                .sort((a, b) => b[1] - a[1])
                .slice(0, 5)
                .map(([t, s]) => `${compactTitle(t)}: ${s}s`)
                .join(', ');
            sections.push({ priority: 2, label: enhanceT('sys.todayActivity'), text: top });
        }

        // Priority 3: RAG usage history (deduplicate similar titles)
        const memoryHits = this.longPool.query(title, { layer: 'memory', maxResults: 5, minConfidence: 0.3 });
        if (memoryHits.length > 0) {
            const merged = [];
            for (const h of memoryHits) {
                const compact = compactTitle(h.title);
                const existing = merged.find(m => m.compact === compact);
                if (existing) {
                    existing.totalSec += h.data.totalSec;
                    existing.dayCount = Math.max(existing.dayCount, h.data.dayCount);
                } else {
                    merged.push({ compact, totalSec: h.data.totalSec, dayCount: h.data.dayCount });
                }
            }
            const summary = merged.slice(0, 3)
                .map(m => `${m.compact}: ${m.totalSec}s, ${m.dayCount}d`)
                .join('; ');
            sections.push({ priority: 3, label: enhanceT('sys.usageHistory'), text: summary });
        }

        // Priority 4: RAG knowledge + VLM keywords + acquired knowledge (merged, sorted by relevance)
        const knowledgeHits = this.longPool.query(title, { layer: 'knowledge', maxResults: 3, minConfidence: 0.3 });
        const vlmKeywordHits = this.longPool.query(title, { layer: 'vlm', maxResults: 2, minConfidence: 0.3 });
        const acquiredHits = this.longPool.query(title, { layer: 'acquired', maxResults: 3, minConfidence: 0.2 })
            .filter(h => !h.data.confidence || h.data.confidence > 0.3);  // Skip low-confidence acquired
        const mergedHits = [
            ...knowledgeHits.map(h => ({ confidence: h.confidence, text: h.confidence > 0.7 ? h.data.summary : h.data.summary.slice(0, 200) })),
            ...vlmKeywordHits.map(h => ({ confidence: h.confidence, text: h.data.summary.slice(0, 150) })),
            ...acquiredHits.map(h => ({ confidence: h.confidence, text: h.data.summary.slice(0, 200) }))
        ].sort((a, b) => b.confidence - a.confidence);
        if (mergedHits.length > 0) {
            sections.push({ priority: 4, label: enhanceT('sys.knowledge'), text: mergedHits.map(h => h.text).join(' | ') });
        }

        // Priority 5: Search results — fresh from ShortTermPool, or cached from LongTermPool
        const searchResults = this.shortPool.get('search.results');
        if (searchResults) {
            sections.push({ priority: 5, label: enhanceT('sys.relatedInfo'), text: searchResults.slice(0, 500) });
        } else {
            // Fallback: RAG-matched cached search results
            const cachedHits = this.longPool.query(title, { layer: 'search', maxResults: 2, minConfidence: 0.3 });
            if (cachedHits.length > 0) {
                const cached = cachedHits.map(h => h.data.results).join(' | ').slice(0, 500);
                sections.push({ priority: 5, label: enhanceT('sys.relatedInfo'), text: cached });
            }
        }

        if (sections.length === 0) return '';

        // Sort by priority (ascending = highest priority first)
        sections.sort((a, b) => a.priority - b.priority);

        // Allocate budget: include sections in priority order, trim last if needed
        const result = [];
        let remaining = TOTAL_BUDGET;

        for (const sec of sections) {
            const formatted = `[${sec.label}] ${sec.text}`;
            if (formatted.length <= remaining) {
                result.push(formatted);
                remaining -= formatted.length;
            } else if (remaining > 20) {
                result.push(formatted.slice(0, remaining));
                remaining = 0;
                break;
            } else {
                break;
            }
        }

        return result.length > 0 ? sanitizeSecrets('\n' + result.join('\n')) : '';
    }

    async stop() {
        this.memoryTracker.stop();
        await this.longPool.flush();
        console.log('[Enhance:Orchestrator] Stopped');
    }

    async reloadConfig() {
        if (window.electronAPI?.loadConfig) {
            const config = await window.electronAPI.loadConfig();
            const enhance = config.enhance || {};
            this.memoryTracker.configure(enhance.memory || {});
            this.searchService.configure(enhance.search || {});
            this.knowledgeStore.configure(enhance.knowledge || {});
            this.vlmExtractor.configure(enhance.vlm || {});
            if (this.knowledgeAcq) this.knowledgeAcq.configure(enhance.knowledgeAcq || {});
            this._maxSearchFrequencyMs = enhance.search?.maxFrequencyMs || 30000;
            this._minFocusSeconds = enhance.search?.minFocusSeconds || 10;
        }
    }
}

if (typeof window !== 'undefined') window.EnhancementOrchestrator = EnhancementOrchestrator;
