/**
 * Knowledge Acquisition — Automated topic discovery and search
 * VLM keywords → LLM topic extraction → LLM search terms → distributed search → knowledge store
 * Queue persists across sessions via LongTermPool
 */
class KnowledgeAcquisition {
    constructor(shortPool, longPool, aiClient, searchService) {
        this.shortPool = shortPool;
        this.longPool = longPool;
        this.aiClient = aiClient;
        this.searchService = searchService;

        this.enabled = false;
        this.minFocusSeconds = 60;
        this.termCooldownMs = 3600000;
        this.maxTermsPerTopic = 15;
        this.maxSearchesPerRequest = 2;
        this.retentionDays = 30;

        this._taskQueue = [];
        this._knownTopics = {};  // {topic: {generatedAt, lang}}
        this._generating = false;
    }

    configure(config) {
        if (config.enabled !== undefined) this.enabled = config.enabled;
        if (config.minFocusSeconds) this.minFocusSeconds = config.minFocusSeconds;
        if (config.termCooldownMs) this.termCooldownMs = config.termCooldownMs;
        if (config.maxTermsPerTopic) this.maxTermsPerTopic = config.maxTermsPerTopic;
        if (config.maxSearchesPerRequest) this.maxSearchesPerRequest = config.maxSearchesPerRequest;
        if (config.retentionDays) this.retentionDays = config.retentionDays;
    }

    async init() {
        this._loadQueue();
        // Rebuild _knownTopics from existing terms in longPool
        for (const title of this.longPool.getAllTitles()) {
            const terms = this.longPool.getForTitle(title, 'terms');
            if (terms) this._knownTopics[title] = {
                generatedAt: terms.generatedAt || 0, lang: terms.lang,
                verified: terms.verified || false
            };
        }
        // Decay old knowledge on startup
        this.decayKnowledge();
        console.log(`[Enhance:KBAcq] Initialized, queue: ${this._taskQueue.filter(t => t.status === 'pending').length} pending`);
    }

    async maybeAcquire(title, vlmKeywords, focusTime) {
        if (!this.enabled || !vlmKeywords || !this.aiClient || this._generating) return;
        if (!this.searchService?.enabled) return;
        if (focusTime < this.minFocusSeconds) return;

        // Step 1: Extract high-level topics from VLM keywords
        const topicPrompt = enhanceT('sys.kbTopicPrompt').replace('{0}', vlmKeywords);
        this._generating = true;
        try {
            const topicResult = await this.aiClient.callAPI([
                { role: 'system', content: topicPrompt },
                { role: 'user', content: 'Extract.' }
            ]);
            const topics = this._parseJSON(topicResult);
            if (!topics || topics.length === 0) return;

            for (const topic of topics.slice(0, 3)) {
                if (!topic || topic.length < 2) continue;
                const topicKey = topic.trim();

                // Check cooldown — verified topics use much longer cooldown
                const known = this._knownTopics[topicKey];
                if (known) {
                    const cooldown = known.verified
                        ? this.termCooldownMs * 24  // verified: ~24x longer (e.g. 24h → ~24 days)
                        : this.termCooldownMs;
                    if (Date.now() - known.generatedAt < cooldown) continue;
                }

                // Step 2: Generate search terms for this topic
                const timestamp = new Date().toISOString().slice(0, 16);
                const termsPrompt = enhanceT('sys.kbTermsPrompt')
                    .replace('{0}', topicKey).replace('{1}', timestamp);
                const termsResult = await this.aiClient.callAPI([
                    { role: 'system', content: termsPrompt },
                    { role: 'user', content: 'Generate.' }
                ]);
                const terms = this._parseJSON(termsResult);
                if (!terms || terms.length === 0) continue;

                // Enqueue search tasks
                const validTerms = terms
                    .filter(t => t && typeof t === 'string' && t.length >= 2)
                    .slice(0, this.maxTermsPerTopic);

                for (const term of validTerms) {
                    // Skip if already in queue
                    if (this._taskQueue.some(t => t.topic === topicKey && t.term === term)) continue;
                    this._taskQueue.push({
                        topic: topicKey, term: term.trim(),
                        status: 'pending', retries: 0, addedAt: Date.now()
                    });
                }

                // Cache terms
                this._knownTopics[topicKey] = { generatedAt: Date.now(), lang: enhanceLang() };
                this.longPool.setForTitle(topicKey, 'terms', {
                    terms: validTerms, generatedAt: Date.now(), lang: enhanceLang()
                });

                console.log(`[Enhance:KBAcq] Generated ${validTerms.length} terms for: ${topicKey}`);
            }

            this._persistQueue();
        } catch (e) {
            console.warn('[Enhance:KBAcq] maybeAcquire error:', e.message);
        } finally {
            this._generating = false;
        }
    }

    async processQueue(maxTasks) {
        if (!this.enabled || !this.searchService?.enabled) return 0;
        const max = maxTasks || this.maxSearchesPerRequest;
        const pending = this._taskQueue.filter(t => t.status === 'pending');
        if (pending.length === 0) return 0;

        let processed = 0;
        for (const task of pending.slice(0, max)) {
            try {
                const query = `${task.topic} ${task.term}`;
                const result = await this.searchService.search(query);
                if (result.success && result.results && result.results.length > 10) {
                    this.longPool.setForTitle(query, 'acquired', {
                        summary: result.results.slice(0, 250),
                        topic: task.topic, term: task.term,
                        confidence: 0.8, originalConfidence: 0.8, searchedAt: Date.now()
                    });
                    task.status = 'done';
                    console.log(`[Enhance:KBAcq] Searched: ${query} -> success`);
                } else if (result.success) {
                    // Empty or too short results → low confidence
                    this.longPool.setForTitle(query, 'acquired', {
                        summary: result.results || '',
                        topic: task.topic, term: task.term,
                        confidence: 0.2, originalConfidence: 0.2, searchedAt: Date.now()
                    });
                    task.status = 'done';
                    console.log(`[Enhance:KBAcq] Searched: ${query} -> low confidence (empty)`);
                } else {
                    task.retries++;
                    if (task.retries >= 3) task.status = 'failed';
                }
            } catch (e) {
                task.retries++;
                if (task.retries >= 3) task.status = 'failed';
            }
            processed++;
        }

        // Remove failed tasks immediately, clean done tasks after 24h
        this._taskQueue = this._taskQueue.filter(t => {
            if (t.status === 'failed') return false;
            if (t.status === 'done' && Date.now() - t.addedAt > 86400000) return false;
            return true;
        });

        // Check for verified topics — if a topic has 3+ high-confidence results, mark verified
        this._checkVerifiedTopics();

        // Prune expired acquired entries (older than retentionDays)
        this._pruneExpiredAcquired();

        this._persistQueue();
        return processed;
    }

    _pruneExpiredAcquired() {
        const maxAge = (this.retentionDays || 30) * 86400000;
        const now = Date.now();
        for (const title of this.longPool.getAllTitles()) {
            const acquired = this.longPool.getForTitle(title, 'acquired');
            if (acquired && acquired.searchedAt && (now - acquired.searchedAt > maxAge)) {
                // Remove expired acquired data
                this.longPool.setForTitle(title, 'acquired', null);
            }
        }
    }

    _parseJSON(text) {
        if (!text) return null;
        try {
            // Try direct parse
            const parsed = JSON.parse(text);
            if (Array.isArray(parsed)) return parsed;
        } catch {}
        // Try extracting JSON array from text
        const match = text.match(/\[[\s\S]*?\]/);
        if (match) {
            try { return JSON.parse(match[0]); } catch {}
        }
        return null;
    }

    _persistQueue() {
        this.longPool.setForTitle('__kbQueue__', 'queue', {
            tasks: this._taskQueue, lastUpdated: Date.now()
        });
    }

    _loadQueue() {
        const data = this.longPool.getForTitle('__kbQueue__', 'queue');
        if (data?.tasks && Array.isArray(data.tasks)) {
            this._taskQueue = data.tasks;
        }
    }

    getQueueStatus() {
        const pending = this._taskQueue.filter(t => t.status === 'pending').length;
        const done = this._taskQueue.filter(t => t.status === 'done').length;
        const failed = this._taskQueue.filter(t => t.status === 'failed').length;
        return { pending, done, failed, total: this._taskQueue.length };
    }

    _checkVerifiedTopics() {
        // Group done tasks by topic, check if enough high-confidence results
        const topicResults = {};
        for (const task of this._taskQueue.filter(t => t.status === 'done')) {
            if (!topicResults[task.topic]) topicResults[task.topic] = 0;
            const acquired = this.longPool.getForTitle(`${task.topic} ${task.term}`, 'acquired');
            if (acquired && acquired.confidence >= 0.8) topicResults[task.topic]++;
        }
        for (const [topic, highConfCount] of Object.entries(topicResults)) {
            if (highConfCount >= 3 && this._knownTopics[topic] && !this._knownTopics[topic].verified) {
                this._knownTopics[topic].verified = true;
                // Persist verified status
                const existing = this.longPool.getForTitle(topic, 'terms') || {};
                this.longPool.setForTitle(topic, 'terms', { ...existing, verified: true, verifiedAt: Date.now() });
                console.log(`[Enhance:KBAcq] Topic verified: ${topic}`);
            }
        }
    }

    /**
     * Decay confidence of old acquired knowledge.
     * Called periodically (e.g. once per session or daily).
     * Entries older than 7 days lose 0.1 confidence per week.
     * Entries below 0.1 confidence are removed.
     */
    decayKnowledge() {
        const now = Date.now();
        const weekMs = 7 * 86400000;
        for (const title of this.longPool.getAllTitles()) {
            const acquired = this.longPool.getForTitle(title, 'acquired');
            if (!acquired || !acquired.searchedAt) continue;
            const age = now - acquired.searchedAt;
            if (age < weekMs) continue;
            const weeksOld = Math.floor(age / weekMs);
            const original = acquired.originalConfidence ?? acquired.confidence ?? 0.8;
            const decayed = original - (weeksOld * 0.1);
            if (decayed <= 0.1) {
                this.longPool.setForTitle(title, 'acquired', null);
                console.log(`[Enhance:KBAcq] Expired: ${title}`);
            } else if (decayed < acquired.confidence) {
                acquired.confidence = Math.round(decayed * 100) / 100;
                if (!acquired.originalConfidence) acquired.originalConfidence = original;
                this.longPool.setForTitle(title, 'acquired', acquired);
            }
        }
        // Prune _knownTopics to cap memory
        this._pruneKnownTopics();
    }

    /** Cap _knownTopics to prevent unbounded growth */
    _pruneKnownTopics(maxEntries = 200) {
        const keys = Object.keys(this._knownTopics);
        if (keys.length <= maxEntries) return;
        const sorted = keys.sort((a, b) => (this._knownTopics[a]?.generatedAt || 0) - (this._knownTopics[b]?.generatedAt || 0));
        for (let i = 0; i < sorted.length - maxEntries; i++) {
            delete this._knownTopics[sorted[i]];
        }
    }
}

if (typeof window !== 'undefined') window.KnowledgeAcquisition = KnowledgeAcquisition;
