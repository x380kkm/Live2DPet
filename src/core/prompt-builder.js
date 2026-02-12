/**
 * Standalone Prompt Builder for Desktop Pet
 * No dependency on PromptSystem or game engine
 */
class PetPromptBuilder {
    constructor() {
        this.characterPrompt = null;
    }

    async init() {
        await this.loadCharacterPrompt();
    }

    async loadCharacterPrompt(characterId) {
        try {
            // Use IPC to load from main process (handles both dev and packaged paths)
            if (window.electronAPI?.loadPrompt) {
                const result = await window.electronAPI.loadPrompt(characterId || null);
                if (result.success) {
                    this.characterPrompt = result.data;
                    console.log(`[PetPromptBuilder] Character loaded: ${this.characterPrompt.name || 'unknown'}`);
                    return;
                }
            }
            // Fallback: fetch from assets (dev mode without IPC)
            const url = characterId
                ? `assets/prompts/${characterId}.json`
                : 'assets/prompts/sister.json';
            const response = await fetch(url);
            const data = await response.json();
            this.characterPrompt = data.data || data;
            console.log(`[PetPromptBuilder] Character loaded (fetch): ${this.characterPrompt.name || 'unknown'}`);
        } catch (error) {
            console.warn('[PetPromptBuilder] Failed to load prompt, using default');
            this.characterPrompt = {
                name: 'Yuki',
                userIdentity: '妹妹',
                userTerm: '你',
                description: '你是{{petName}}，用户的{{userIdentity}}。',
                personality: '简短、自然、有温度。',
                scenario: '回复必须简短（1-2句话）。'
            };
        }
    }

    /**
     * Replace {{petName}}, {{userIdentity}}, {{userTerm}} in text
     */
    resolveTemplate(text) {
        if (!text || !this.characterPrompt) return text;
        const vars = {
            '{{petName}}': this.characterPrompt.name || 'Yuki',
            '{{userIdentity}}': this.characterPrompt.userIdentity || '妹妹',
            '{{userTerm}}': this.characterPrompt.userTerm || '你'
        };
        let result = text;
        for (const [placeholder, value] of Object.entries(vars)) {
            result = result.split(placeholder).join(value);
        }
        return result;
    }

    buildSystemPrompt(dynamicContext) {
        if (!this.characterPrompt) return 'You are a desktop pet companion.';
        const parts = [];

        // Fast response instruction at the top
        parts.push('【响应模式】直接回答，不要思考过程，不要推理步骤，立即给出最终回复。');

        // Character setup
        if (this.characterPrompt.description) parts.push(this.resolveTemplate(this.characterPrompt.description));
        if (this.characterPrompt.personality) parts.push(this.resolveTemplate(this.characterPrompt.personality));
        if (this.characterPrompt.scenario) parts.push(this.resolveTemplate(this.characterPrompt.scenario));
        if (dynamicContext) parts.push(dynamicContext);

        // Rules LAST with emphasis
        if (this.characterPrompt.rules) {
            parts.push('---');
            parts.push(this.resolveTemplate(this.characterPrompt.rules));
            parts.push('【重要提醒】以上规则必须严格遵守，每次回复前请检查是否符合所有规则。');
        }

        return parts.join('\n\n');
    }

    getAppDetectionPrompt(appName) {
        return `（system：当前用户正在使用应用${appName}，请自然地回应一句）`;
    }

    getIdlePrompt() {
        const triggers = [
            '（system：用户一段时间没有操作，根据屏幕内容说说自己想说的吧）',
            '（system：主动找个话题，可以是屏幕上看到的内容，也可以是你自己的想法）',
            '（system：对屏幕上的内容发表一下你的看法或感想吧）',
            '（system：分享一下此刻的心情，或者对用户正在做的事情表达关心）'
        ];
        return triggers[Math.floor(Math.random() * triggers.length)];
    }
}

window.PetPromptBuilder = PetPromptBuilder;
