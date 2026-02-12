/**
 * Translation Service — Text → Japanese via LLM API
 *
 * Runs in Electron main process. Uses the same OpenAI-compatible API
 * as the chat client to translate text to Japanese for VOICEVOX.
 * Includes a simple cache to avoid redundant translations.
 */

class TranslationService {
    constructor() {
        this.apiKey = '';
        this.baseURL = '';
        this.modelName = '';
        this.enabled = true;
        this.cache = new Map();
        this.cacheMaxSize = 50;
    }

    configure({ apiKey, baseURL, modelName } = {}) {
        if (apiKey !== undefined) this.apiKey = apiKey;
        if (baseURL !== undefined) this.baseURL = baseURL;
        if (modelName !== undefined) this.modelName = modelName;
    }

    isConfigured() {
        return !!(this.apiKey && this.baseURL && this.modelName);
    }

    /**
     * Translate text to Japanese.
     * @param {string} text - Input text
     * @returns {Promise<string>} Japanese text, or original on failure
     */
    async translate(text) {
        if (!text || !this.enabled) return text;
        if (!this.isConfigured()) return text;
        if (this.cache.has(text)) return this.cache.get(text);

        try {
            const result = await this._callAPI(text);
            if (result) {
                this._cacheSet(text, result);
                return result;
            }
            return text;
        } catch (err) {
            console.error('[Translation] Failed:', err.message);
            return text;
        }
    }

    async _callAPI(text) {
        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), 15000);

        try {
            const response = await fetch(`${this.baseURL}/chat/completions`, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'Authorization': `Bearer ${this.apiKey}`
                },
                body: JSON.stringify({
                    model: this.modelName,
                    messages: [
                        {
                            role: 'system',
                            content: '【响应模式】你是翻译器。将用户输入翻译成自然的日语。不要思考,快速并只输出翻译结果，不要解释。保持语气和情感。英文单词转为片假名。'
                        },
                        { role: 'user', content: text }
                    ],
                    max_tokens: 1024,
                    temperature: 0.3
                }),
                signal: controller.signal
            });

            clearTimeout(timeoutId);
            if (!response.ok) return null;

            const data = await response.json();
            const result = data.choices?.[0]?.message?.content?.trim();
            if (!result) return null;

            return result
                .replace(/<think>[\s\S]*?<\/think>/gi, '')
                .replace(/<thinking>[\s\S]*?<\/thinking>/gi, '')
                .trim();
        } catch (err) {
            clearTimeout(timeoutId);
            throw err;
        }
    }

    _cacheSet(key, value) {
        if (this.cache.size >= this.cacheMaxSize) {
            const firstKey = this.cache.keys().next().value;
            this.cache.delete(firstKey);
        }
        this.cache.set(key, value);
    }

    clearCache() { this.cache.clear(); }
}

module.exports = { TranslationService };
