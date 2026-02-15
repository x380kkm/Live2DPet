/**
 * Search Service — Web search via main process IPC
 * Supports DuckDuckGo (scraping) and custom API endpoints (Bing API, SearXNG, etc.)
 */
class SearchService {
    constructor() {
        this.enabled = false;
        this.provider = 'custom';
        this.customUrl = '';
        this.customApiKey = '';
        this.customHeaders = null;
    }

    configure(config) {
        if (config.enabled !== undefined) this.enabled = config.enabled;
        if (config.provider) this.provider = config.provider;
        if (config.customUrl !== undefined) this.customUrl = config.customUrl;
        if (config.customApiKey !== undefined) this.customApiKey = config.customApiKey;
        if (config.customHeaders !== undefined) this.customHeaders = config.customHeaders;
    }

    async search(query) {
        if (!this.enabled || !query) {
            return { success: false, error: 'disabled' };
        }
        if (!window.electronAPI?.webSearch) {
            return { success: false, error: 'no_ipc' };
        }
        try {
            const options = {};
            if (this.provider === 'custom') {
                options.customUrl = this.customUrl;
                options.customApiKey = this.customApiKey;
                if (this.customHeaders) options.customHeaders = this.customHeaders;
            }
            const result = await window.electronAPI.webSearch(query, this.provider, options);
            return result;
        } catch (e) {
            console.error('[Enhance:Search] Error:', e.message);
            return { success: false, error: e.message };
        }
    }
}

if (typeof window !== 'undefined') window.SearchService = SearchService;
