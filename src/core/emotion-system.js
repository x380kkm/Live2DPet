/**
 * Emotion System for Desktop Pet (Decoupled)
 *
 * Responsibilities:
 * - Accumulate emotion value over time
 * - Select emotion via AI when threshold reached
 * - Output emotion name via callback (does NOT directly send IPC)
 *
 * Expression rendering is handled by desktop-pet-system → ModelAdapter.
 */
class EmotionSystem {
    constructor(petSystem) {
        this.petSystem = petSystem;

        // Unified emotion items — [{name, label, type:'expression'|'motion', file?, group?, index?}]
        this.emotionItems = [];
        this.enabledEmotions = [];

        // Legacy alias for backward compat (tests, etc.)
        this.emotionExpressions = this.emotionItems;

        // Emotion value (meter)
        this.emotionValue = 0;
        this.emotionThreshold = 100;

        // Timing
        this.expectedFrequencySeconds = 60;
        this.accumulationTickMs = 1000;
        this.accumulationTimer = null;

        // Accumulation rates
        this.baseAccumulationRate = 0;
        this.hoverAccumulationRate = 0;
        this.isHovering = false;

        // Expression playback state
        this.isPlayingExpression = false;
        this.isPlayingMotion = false;
        this.expressionTimer = null;
        this.motionTimer = null;
        this.defaultExpressionDuration = 5000;
        this.expressionDurations = {};
        this.defaultMotionDuration = 3000;
        this.motionDurations = {};

        // Simultaneous mode: allow expression + motion to overlap
        this.allowSimultaneous = false;

        // Next emotion buffer (set by AI, cleared on play)
        this.nextEmotionBuffer = null;
        this.isSelectingEmotion = false;

        // Callbacks
        this.onEmotionTriggered = null;   // (emotionName) — for expressions
        this.onEmotionReverted = null;    // () — for expressions
        this.onMotionTriggered = null;    // (group, index, emotionName) — for motions

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

    /**
     * Configure expressions from config.
     * @param {Array} expressions - [{name, label, file?}]
     * @param {Object} durations - {expressionName: durationMs}
     * @param {number} defaultDuration - fallback duration
     */
    configureExpressions(expressions, durations, defaultDuration) {
        // Remove existing expression items, keep motions
        this.emotionItems = this.emotionItems.filter(e => e.type === 'motion');
        // Add expression items
        const exprItems = (expressions || []).map(e => ({
            ...e, type: 'expression'
        }));
        this.emotionItems.push(...exprItems);
        this.emotionExpressions = this.emotionItems;
        this.expressionDurations = durations || {};
        this.defaultExpressionDuration = defaultDuration || 5000;
        // Enable all by default
        this.enabledEmotions = this.emotionItems.map(e => e.name);
    }

    /**
     * Configure motions as emotion items.
     * @param {Array} motionEmotions - [{name, group, index}]
     * @param {Object} durations - {motionName: durationMs}
     * @param {number} defaultDuration - fallback duration for motions
     */
    configureMotions(motionEmotions, durations, defaultDuration) {
        // Remove existing motion items, keep expressions
        this.emotionItems = this.emotionItems.filter(e => e.type === 'expression');
        // Add motion items
        const motionItems = (motionEmotions || []).map(m => ({
            name: m.name, label: m.name, type: 'motion',
            group: m.group, index: m.index
        }));
        this.emotionItems.push(...motionItems);
        this.emotionExpressions = this.emotionItems;
        this.motionDurations = durations || {};
        this.defaultMotionDuration = defaultDuration || 3000;
        // Re-enable all
        this.enabledEmotions = this.emotionItems.map(e => e.name);
    }

    start() {
        // Don't start if no emotion items configured
        if (this.emotionItems.length === 0) {
            console.log('[EmotionSystem] No emotions configured, not starting');
            return;
        }
        this.stop();
        this.emotionValue = 0;
        this.isPlayingExpression = false;
        this.isPlayingMotion = false;
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
        if (this.motionTimer) {
            clearTimeout(this.motionTimer);
            this.motionTimer = null;
        }
        this.emotionValue = 0;
        this.isPlayingExpression = false;
        this.isPlayingMotion = false;
        this.nextEmotionBuffer = null;
    }

    /** Check if accumulation should be blocked */
    _isBusy() {
        if (this.allowSimultaneous) {
            return this.isPlayingExpression && this.isPlayingMotion;
        }
        return this.isPlayingExpression || this.isPlayingMotion;
    }

    _tick() {
        if (this._isBusy()) return;

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
        if (this._isBusy()) return;

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
                const item = this.emotionItems.find(e => e.name === name);
                return `${name}(${item?.label || name})`;
            }).join(', ');

            const messages = [
                {
                    role: 'system',
                    content: `You are an emotion classifier. Given the character's last spoken line, pick the single most fitting emotion from this list: [${emotionList}]. Reply with ONLY the emotion name from the list, nothing else.`
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

    /**
     * Force-revert any currently playing emotion (used when session is cancelled).
     */
    forceRevert() {
        if (this.expressionTimer) {
            clearTimeout(this.expressionTimer);
            this.expressionTimer = null;
            this.isPlayingExpression = false;
            if (this.onEmotionReverted) this.onEmotionReverted();
        }
        if (this.motionTimer) {
            clearTimeout(this.motionTimer);
            this.motionTimer = null;
            this.isPlayingMotion = false;
        }
    }

    /**
     * Force-trigger an emotion aligned to external duration (e.g. TTS audio).
     * Bypasses normal threshold — uses nextEmotionBuffer or random.
     * @param {number} durationMs - aligned duration for the emotion display
     */
    triggerAligned(durationMs) {
        if (this.enabledEmotions.length === 0) return;
        if (this._isBusy()) return;

        this._triggerExpressionWithDuration(durationMs);
    }

    async _triggerExpression() {
        this._triggerExpressionWithDuration(null);
    }

    /**
     * Core trigger logic. If overrideDuration is provided, use it instead of per-emotion default.
     */
    _triggerExpressionWithDuration(overrideDuration) {
        if (this.enabledEmotions.length === 0) return;

        // Filter available emotions based on current locks
        let available = this.enabledEmotions;
        if (this.allowSimultaneous) {
            available = this.enabledEmotions.filter(name => {
                const item = this.emotionItems.find(e => e.name === name);
                if (item?.type === 'motion') return !this.isPlayingMotion;
                return !this.isPlayingExpression;
            });
        } else {
            if (this.isPlayingExpression || this.isPlayingMotion) return;
        }
        if (available.length === 0) return;

        let emotionName;
        if (this.nextEmotionBuffer && available.includes(this.nextEmotionBuffer)) {
            emotionName = this.nextEmotionBuffer;
        } else {
            emotionName = available[
                Math.floor(Math.random() * available.length)
            ];
        }

        this.nextEmotionBuffer = null;
        this.emotionValue = 0;

        const item = this.emotionItems.find(e => e.name === emotionName);
        const itemType = item?.type || 'expression';

        // Set type-specific lock
        if (itemType === 'motion') {
            this.isPlayingMotion = true;
        } else {
            this.isPlayingExpression = true;
        }

        const aligned = overrideDuration !== null;
        console.log(`[EmotionSystem] Playing: ${emotionName} (type: ${itemType}${aligned ? ', aligned' : ''})`);

        // Dispatch based on type
        if (itemType === 'motion' && this.onMotionTriggered) {
            this.onMotionTriggered(item.group, item.index, emotionName);
        } else if (this.onEmotionTriggered) {
            this.onEmotionTriggered(emotionName);
        }

        // Duration: use override (TTS-aligned) or per-emotion default
        let duration;
        if (overrideDuration !== null) {
            duration = overrideDuration;
        } else if (itemType === 'motion') {
            duration = this.motionDurations[emotionName] || this.defaultMotionDuration;
        } else {
            duration = this.expressionDurations[emotionName] || this.defaultExpressionDuration;
        }

        const timer = setTimeout(() => {
            if (itemType === 'expression' && this.onEmotionReverted) {
                this.onEmotionReverted();
            }
            if (itemType === 'motion') {
                this.isPlayingMotion = false;
                this.motionTimer = null;
            } else {
                this.isPlayingExpression = false;
                this.expressionTimer = null;
            }
            console.log(`[EmotionSystem] ${itemType} reverted, accumulation resumed`);
        }, duration);

        if (itemType === 'motion') {
            this.motionTimer = timer;
        } else {
            this.expressionTimer = timer;
        }
    }

    async loadConfig() {
        try {
            if (window.electronAPI && window.electronAPI.loadConfig) {
                const config = await window.electronAPI.loadConfig();
                if (config.emotionFrequency) {
                    this.expectedFrequencySeconds = Math.max(30, config.emotionFrequency);
                }
                // Load expressions from model config
                if (config.model && config.model.hasExpressions) {
                    this.configureExpressions(
                        config.model.expressions,
                        config.model.expressionDurations,
                        config.model.defaultExpressionDuration
                    );
                }
                // Load motions from model config
                if (config.model && config.model.motionEmotions && config.model.motionEmotions.length > 0) {
                    this.configureMotions(
                        config.model.motionEmotions,
                        config.model.motionDurations,
                        config.model.defaultMotionDuration
                    );
                }
                if (config.allowSimultaneous !== undefined) {
                    this.allowSimultaneous = !!config.allowSimultaneous;
                }
                if (config.enabledEmotions && Array.isArray(config.enabledEmotions) && config.enabledEmotions.length > 0) {
                    this.setEnabledEmotions(config.enabledEmotions);
                }
                this._recalculateRates();
            }
        } catch (e) {
            console.warn('[EmotionSystem] Failed to load config:', e);
        }
    }

    setEnabledEmotions(names) {
        this.enabledEmotions = names.filter(n =>
            this.emotionItems.some(e => e.name === n)
        );
        if (window.electronAPI && window.electronAPI.saveConfig) {
            window.electronAPI.saveConfig({ enabledEmotions: this.enabledEmotions });
        }
    }
}

window.EmotionSystem = EmotionSystem;
