/**
 * Simplified AI Chat for Desktop Pet
 * Supports OpenAI-compatible APIs (Grok, Claude proxy, Deepseek, etc.)
 */
class AIChatClient {
    constructor() {
        this.apiKey = '';
        this.baseURL = 'https://openrouter.ai/api/v1';
        this.modelName = 'x-ai/grok-4.1-fast';
        this.conversationHistory = [];
        this.maxHistoryPairs = 3;
        this.isLoading = false;
    }

    async init() {
        await this.loadConfig();
        console.log('[AIChatClient] Initialized:', this.baseURL, this.modelName);
    }

    async loadConfig() {
        try {
            if (window.electronAPI && window.electronAPI.loadConfig) {
                const config = await window.electronAPI.loadConfig();
                if (config.apiKey) this.apiKey = config.apiKey;
                if (config.baseURL) this.baseURL = config.baseURL;
                if (config.modelName) this.modelName = config.modelName;
            }
        } catch (e) {
            console.warn('[AIChatClient] Failed to load config:', e);
        }
    }

    saveConfig(config) {
        if (config.apiKey !== undefined) this.apiKey = config.apiKey;
        if (config.baseURL !== undefined) this.baseURL = config.baseURL;
        if (config.modelName !== undefined) this.modelName = config.modelName;
        if (window.electronAPI && window.electronAPI.saveConfig) {
            window.electronAPI.saveConfig({
                apiKey: this.apiKey,
                baseURL: this.baseURL,
                modelName: this.modelName
            });
        }
    }

    getConfig() {
        return { apiKey: this.apiKey, baseURL: this.baseURL, modelName: this.modelName };
    }

    isConfigured() {
        return !!(this.apiKey && this.baseURL && this.modelName);
    }

    /**
     * Send messages directly to the API (for vision/screenshot requests)
     * @param {Array} messages - Full messages array [{role, content}]
     * @returns {string} AI response text
     */
    async callAPI(messages) {
        if (!this.isConfigured()) throw new Error('API not configured');

        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), 30000);

        try {
            const response = await fetch(`${this.baseURL}/chat/completions`, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'Authorization': `Bearer ${this.apiKey}`
                },
                body: JSON.stringify({
                    model: this.modelName,
                    messages: messages,
                    max_tokens: 512,
                    temperature: 0.8
                }),
                signal: controller.signal
            });

            clearTimeout(timeoutId);

            if (!response.ok) {
                const errorText = await response.text();
                throw new Error(`API error ${response.status}: ${errorText}`);
            }

            const data = await response.json();
            if (!data.choices?.[0]?.message?.content) {
                throw new Error('Empty API response');
            }

            return this.cleanResponse(data.choices[0].message.content.trim());
        } catch (error) {
            clearTimeout(timeoutId);
            if (error.name === 'AbortError') throw new Error('API request timeout (30s)');
            throw error;
        }
    }

    cleanResponse(content) {
        if (!content) return content;
        return content
            .replace(/<think>[\s\S]*?<\/think>/gi, '')
            .replace(/<thinking>[\s\S]*?<\/thinking>/gi, '')
            .replace(/<think>[\s\S]*$/gi, '')
            .replace(/\n\s*\n\s*\n/g, '\n\n')
            .trim();
    }

    async testConnection() {
        try {
            const response = await this.callAPI([
                { role: 'system', content: 'Reply OK.' },
                { role: 'user', content: 'test' }
            ]);
            return { success: true, response };
        } catch (error) {
            return { success: false, error: error.message };
        }
    }
}

window.AIChatClient = AIChatClient;
