/**
 * Emotion System for Desktop Pet
 * Manages emotion value accumulation, AI-based emotion selection,
 * and expression triggering on the Live2D model via IPC.
 */
class EmotionSystem {
    constructor(petSystem) {
        this.petSystem = petSystem;

        this.emotionExpressions = [
            { name: '脸红', label: 'Blush' },
            { name: '生气', label: 'Angry' },
            { name: '流泪', label: 'Tears' },
            { name: '晕',   label: 'Dizzy' },
            { name: '脸黑', label: 'Annoyed' }
        ];
        this.enabledEmotions = ['脸红', '生气', '流泪', '晕', '脸黑'];

        // Emotion value (meter)
        this.emotionValue = 0;
        this.emotionThreshold = 100;

        // Timing
        this.expectedFrequencySeconds = 60; // configurable, min 30
        this.accumulationTickMs = 1000;
        this.accumulationTimer = null;

        // Accumulation rates (recalculated when frequency changes)
        this.baseAccumulationRate = 0;
        this.hoverAccumulationRate = 0;
        this.isHovering = false;

        // Expression playback state
        this.isPlayingExpression = false;
        this.expressionTimer = null;
        this.expressionDurationMs = 5000;

        // Next emotion buffer (set by AI, cleared on play)
        this.nextEmotionBuffer = null;
        this.isSelectingEmotion = false;

        this._recalculateRates();
    }

    _recalculateRates() {
        const ticksPerPeriod = (this.expectedFrequencySeconds * 1000) / this.accumulationTickMs;
        this.baseAccumulationRate = this.emotionThreshold / ticksPerPeriod;
        this.hoverAccumulationRate = this.baseAccumulationRate * 0.5;
    }

    setExpectedFrequency(seconds) {
        this.expectedFrequencySeconds = Math.max(30, seconds);
        this._recalculateRates();
        if (window.electronAPI && window.electronAPI.saveConfig) {
            window.electronAPI.saveConfig({ emotionFrequency: this.expectedFrequencySeconds });
        }
    }

    start() {
        this.stop();
        this.emotionValue = 0;
        this.isPlayingExpression = false;
        this.nextEmotionBuffer = null;
        this.accumulationTimer = setInterval(() => this._tick(), this.accumulationTickMs);
        console.log('[EmotionSystem] Started');
    }

    stop() {
        if (this.accumulationTimer) {
            clearInterval(this.accumulationTimer);
            this.accumulationTimer = null;
        }
        if (this.expressionTimer) {
            clearTimeout(this.expressionTimer);
            this.expressionTimer = null;
        }
        this.emotionValue = 0;
        this.isPlayingExpression = false;
        this.nextEmotionBuffer = null;
    }

    _tick() {
        if (this.isPlayingExpression) return;

        this.emotionValue += this.baseAccumulationRate;
        if (this.isHovering) {
            this.emotionValue += this.hoverAccumulationRate;
        }

        if (this.emotionValue >= this.emotionThreshold) {
            this._triggerExpression();
        }
    }

    setHoverState(hovering) {
        this.isHovering = hovering;
    }

    onAIResponse(responseText) {
        if (this.isPlayingExpression) return;

        const lengthFactor = Math.min(responseText.length / 200, 1);
        const bonus = 5 + Math.random() * 25 * lengthFactor;
        this.emotionValue += bonus;
        console.log(`[EmotionSystem] AI bonus: +${bonus.toFixed(1)}, total: ${this.emotionValue.toFixed(1)}`);

        this._selectEmotionFromAI(responseText);

        if (this.emotionValue >= this.emotionThreshold) {
            this._triggerExpression();
        }
    }

    async _selectEmotionFromAI(responseText) {
        if (this.isSelectingEmotion || this.enabledEmotions.length === 0) return;

        this.isSelectingEmotion = true;
        try {
            const emotionList = this.enabledEmotions.map(name => {
                const expr = this.emotionExpressions.find(e => e.name === name);
                return `${name}(${expr?.label || name})`;
            }).join(', ');

            const messages = [
                {
                    role: 'system',
                    content: `You are an emotion classifier. Given the character's last spoken line, pick the single most fitting emotion from this list: [${emotionList}]. Reply with ONLY the emotion name in Chinese, nothing else.`
                },
                {
                    role: 'user',
                    content: `Character said: "${responseText}"\nWhich emotion?`
                }
            ];

            const result = await this.petSystem.aiClient.callAPI(messages);
            const picked = result?.trim();

            if (this.enabledEmotions.includes(picked)) {
                this.nextEmotionBuffer = picked;
                console.log(`[EmotionSystem] AI picked: ${picked}`);
            } else {
                const match = this.enabledEmotions.find(e => picked?.includes(e));
                if (match) {
                    this.nextEmotionBuffer = match;
                    console.log(`[EmotionSystem] AI picked (fuzzy): ${match}`);
                }
            }
        } catch (error) {
            console.warn('[EmotionSystem] Emotion selection failed:', error.message);
        } finally {
            this.isSelectingEmotion = false;
        }
    }

    async _triggerExpression() {
        if (this.isPlayingExpression || this.enabledEmotions.length === 0) return;

        let emotionName;
        if (this.nextEmotionBuffer && this.enabledEmotions.includes(this.nextEmotionBuffer)) {
            emotionName = this.nextEmotionBuffer;
        } else {
            emotionName = this.enabledEmotions[
                Math.floor(Math.random() * this.enabledEmotions.length)
            ];
        }

        this.nextEmotionBuffer = null;
        this.emotionValue = 0;
        this.isPlayingExpression = true;

        console.log(`[EmotionSystem] Playing: ${emotionName}`);

        try {
            await window.electronAPI.triggerExpression(emotionName);
        } catch (e) {
            console.error('[EmotionSystem] Trigger failed:', e);
        }

        this.expressionTimer = setTimeout(async () => {
            try {
                await window.electronAPI.revertExpression();
            } catch (e) {
                console.error('[EmotionSystem] Revert failed:', e);
            }
            this.isPlayingExpression = false;
            this.expressionTimer = null;
            console.log('[EmotionSystem] Reverted, accumulation resumed');
        }, this.expressionDurationMs);
    }

    async loadConfig() {
        try {
            if (window.electronAPI && window.electronAPI.loadConfig) {
                const config = await window.electronAPI.loadConfig();
                if (config.emotionFrequency) {
                    this.expectedFrequencySeconds = Math.max(30, config.emotionFrequency);
                }
                if (config.enabledEmotions && Array.isArray(config.enabledEmotions)) {
                    this.enabledEmotions = config.enabledEmotions;
                }
                this._recalculateRates();
            }
        } catch (e) {
            console.warn('[EmotionSystem] Failed to load config:', e);
        }
    }

    setEnabledEmotions(names) {
        this.enabledEmotions = names.filter(n =>
            this.emotionExpressions.some(e => e.name === n)
        );
        if (window.electronAPI && window.electronAPI.saveConfig) {
            window.electronAPI.saveConfig({ enabledEmotions: this.enabledEmotions });
        }
    }
}

window.EmotionSystem = EmotionSystem;
