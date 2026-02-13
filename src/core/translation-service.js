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
                            content: 'あなたは翻訳機です。入力文を自然な日本語の完全な文に翻訳してください。英単語はカタカナに変換（例: YouTube→ユーチューブ、Discord→ディスコード）。翻訳結果の文だけを出力。説明・補足・比較・単語リスト・ローマ字は不要。出力にアルファベットを含めないこと。口調と感情を保持。'
                        },
                        { role: 'user', content: '嘻嘻……你在看YouTube上的ASMR吧，杂鱼哥哥真是变态呢~' },
                        { role: 'assistant', content: 'うふふ……ユーチューブでエーエスエムアール見てるでしょ、雑魚お兄ちゃんって本当に変態だよね～' },
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
                .replace(/[*_`#\[\]]/g, '')
                .replace(/\s{2,}/g, ' ')
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
