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

    async loadCharacterPrompt() {
        try {
            const response = await fetch('assets/prompts/sister.json');
            const data = await response.json();
            this.characterPrompt = data.data || data;
            console.log('[PetPromptBuilder] Character prompt loaded');
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
        if (this.characterPrompt.description) parts.push(this.resolveTemplate(this.characterPrompt.description));
        if (this.characterPrompt.personality) parts.push(this.resolveTemplate(this.characterPrompt.personality));
        if (this.characterPrompt.rules) parts.push(this.resolveTemplate(this.characterPrompt.rules));
        if (this.characterPrompt.scenario) parts.push(this.resolveTemplate(this.characterPrompt.scenario));
        if (dynamicContext) parts.push(dynamicContext);
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
