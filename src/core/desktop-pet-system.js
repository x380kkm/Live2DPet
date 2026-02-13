/**
 * Standalone Desktop Pet System
 * No game engine dependency - runs independently
 */
class DesktopPetSystem {
    constructor() {
        this.isActive = false;
        this.aiClient = null;
        this.promptBuilder = null;
        this.systemPrompt = null;
        this.detectionInterval = null;
        this.detectionIntervalMs = 30000;
        this.lastAppName = null;
        this.isRequesting = false;
        this.emotionSystem = null;

        // Audio state machine + playback tracking
        this.audioStateMachine = null;
        this.currentAudio = null;
        this.currentAudioUrl = null;
        this.currentSession = null;

        // Screenshot buffer system (5s interval, per-window)
        this.screenshotTimer = null;
        this.screenshotBuffers = {};
        this.maxScreenshotsPerWindow = 3;

        // Window focus tracking (1s sampling, cleared after each AI request)
        this.focusTimer = null;
        this.focusTracker = {};

        // Conversation history buffer (avoid repeating topics)
        this.conversationHistory = [];
        this.maxHistoryPairs = 4;

        // Message double-buffer: always play the latest, skip stale ones
        this.pendingMessage = null;   // next message to play (overwritten by newer)
        this.isPlayingMessage = false; // lock: currently playing a session
        this.chatGapMs = 5000;        // minimum gap between two message sessions
    }

    async init() {
        this.aiClient = new AIChatClient();
        await this.aiClient.init();

        this.promptBuilder = new PetPromptBuilder();
        await this.promptBuilder.init();

        this.systemPrompt = this.promptBuilder.buildSystemPrompt();

        this.emotionSystem = new EmotionSystem(this);
        await this.emotionSystem.loadConfig();

        // Audio state machine
        this.audioStateMachine = new AudioStateMachine();
        await this._initAudioState();

        console.log('[DesktopPetSystem] Initialized');
    }

    async _initAudioState() {
        if (!window.electronAPI) return;
        // Load preferred mode from config
        try {
            const config = await window.electronAPI.loadConfig();
            const mode = config.tts?.audioMode || 'tts';
            this.audioStateMachine.setPreferredMode(mode);
        } catch (e) {}
        // Check TTS availability
        if (window.electronAPI.ttsGetStatus) {
            try {
                const status = await window.electronAPI.ttsGetStatus();
                this.audioStateMachine.setTTSAvailable(status.initialized && !status.degraded);
            } catch (e) {}
        }
        // Load default audio clips
        if (window.electronAPI.loadDefaultAudio) {
            try {
                const result = await window.electronAPI.loadDefaultAudio();
                if (result.success && result.files.length > 0) {
                    const clips = result.files.map(f => {
                        const bytes = Uint8Array.from(atob(f.base64), c => c.charCodeAt(0));
                        const blob = new Blob([bytes], { type: 'audio/wav' });
                        return new Audio(URL.createObjectURL(blob));
                    });
                    this.audioStateMachine.setDefaultAudioAvailable(true, clips);
                }
            } catch (e) {}
        }
        console.log('[DesktopPetSystem] Audio mode:', this.audioStateMachine.effectiveMode);
    }

    async start() {
        if (this.isActive) return;
        if (!this.aiClient.isConfigured()) {
            console.warn('[DesktopPetSystem] API not configured');
            if (window.electronAPI) window.electronAPI.showSettings();
            return;
        }

        try {
            const result = await window.electronAPI.createPetWindow({});
            if (result.success) {
                this.isActive = true;
                this.startDetection();
                this.startScreenshotTimer();
                this.startFocusTimer();
                this.emotionSystem.start();
                console.log('[DesktopPetSystem] Started');
            }
        } catch (error) {
            console.error('[DesktopPetSystem] Failed to start:', error);
        }
    }

    async stop() {
        if (!this.isActive) return;
        this.stopDetection();
        this.stopScreenshotTimer();
        this.stopFocusTimer();
        this.stopCurrentAudio();
        this.emotionSystem.stop();
        try {
            await window.electronAPI.closePetWindow();
        } catch (e) {}
        this.isActive = false;
        this.focusTracker = {};
        this.screenshotBuffers = {};
        this.conversationHistory = [];
        this.pendingMessage = null;
        this.isPlayingMessage = false;
        console.log('[DesktopPetSystem] Stopped');
    }

    startDetection() {
        this.stopDetection();
        this.detectionInterval = setInterval(() => this.tick(), this.detectionIntervalMs);
        setTimeout(() => this.tick(), 3000);
        console.log(`[DesktopPetSystem] Detection started, interval: ${this.detectionIntervalMs}ms`);
    }

    stopDetection() {
        if (this.detectionInterval) {
            clearInterval(this.detectionInterval);
            this.detectionInterval = null;
        }
    }

    setInterval(ms) {
        this.detectionIntervalMs = Math.max(10000, ms);
        if (this.isActive) this.startDetection();
    }

    // ========== Screenshot Timer (5s) ==========

    startScreenshotTimer() {
        this.stopScreenshotTimer();
        this.screenshotTimer = setInterval(() => this.screenshotTick(), 5000);
        console.log('[DesktopPetSystem] Screenshot timer started (5s interval)');
    }

    stopScreenshotTimer() {
        if (this.screenshotTimer) {
            clearInterval(this.screenshotTimer);
            this.screenshotTimer = null;
        }
    }

    async screenshotTick() {
        if (!this.isActive) return;

        try {
            const result = await window.electronAPI.getActiveWindow();
            if (!result?.success || !result.data?.owner?.name) return;

            const appName = result.data.owner.name;
            if (this.shouldSkipApp(appName)) return;

            // Capture screenshot
            let screenBase64 = null;
            try {
                screenBase64 = await window.electronAPI.getScreenCapture();
            } catch (e) { return; }
            if (!screenBase64) return;

            // Store in per-window buffer
            if (!this.screenshotBuffers[appName]) this.screenshotBuffers[appName] = [];
            this.screenshotBuffers[appName].push({
                base64: screenBase64,
                timestamp: Date.now(),
                sent: false
            });

            // Keep only the most recent N per window
            while (this.screenshotBuffers[appName].length > this.maxScreenshotsPerWindow) {
                this.screenshotBuffers[appName].shift();
            }
        } catch (error) {
            console.error('[DesktopPetSystem] Screenshot tick error:', error);
        }
    }

    // ========== Focus Tracking (1s) ==========

    startFocusTimer() {
        this.stopFocusTimer();
        this.focusTimer = setInterval(() => this.focusTick(), 1000);
        console.log('[DesktopPetSystem] Focus timer started (1s interval)');
    }

    stopFocusTimer() {
        if (this.focusTimer) {
            clearInterval(this.focusTimer);
            this.focusTimer = null;
        }
    }

    async focusTick() {
        if (!this.isActive) return;
        try {
            const result = await window.electronAPI.getActiveWindow();
            if (!result?.success || !result.data?.owner?.name) return;
            const appName = result.data.owner.name;
            if (this.shouldSkipApp(appName)) return;
            if (!this.focusTracker[appName]) this.focusTracker[appName] = 0;
            this.focusTracker[appName] += 1;
        } catch (e) {}
    }

    // ========== Knowledge Layer ==========

    buildDynamicContext() {
        const parts = [];

        // Self-awareness: appearance (know but don't mention)
        parts.push('【自我认知】你的外观是一个粉色恶魔(Pink Devil)风格的Live2D角色，但你不应该主动提及自己的外观或Live2D相关的事情。');

        // Self-awareness: emotion state
        if (this.emotionSystem) {
            const emotionVal = Math.round(this.emotionSystem.emotionValue);
            const nextEmotion = this.emotionSystem.nextEmotionBuffer;
            parts.push(`【当前情绪状态】情绪值: ${emotionVal}/100${nextEmotion ? '，下一个表情倾向: ' + nextEmotion : ''}`);
        }

        // Window focus tracking summary
        if (Object.keys(this.focusTracker).length > 0) {
            const focusEntries = Object.entries(this.focusTracker)
                .sort((a, b) => b[1] - a[1])
                .map(([name, seconds]) => `${name}: ${seconds}秒`)
                .join(', ');
            parts.push(`【最近窗口使用情况】${focusEntries}`);
        }

        return parts.join('\n');
    }

    // ========== Main Tick & Request ==========

    async tick() {
        if (!this.isActive || this.isRequesting || !this.aiClient.isConfigured()) return;

        try {
            const result = await window.electronAPI.getActiveWindow();
            if (!result?.success || !result.data?.owner?.name) return;

            const appName = result.data.owner.name;
            if (this.shouldSkipApp(appName)) return;

            this.lastAppName = appName;
            await this.sendRequest(appName);
        } catch (error) {
            console.error('[DesktopPetSystem] Tick error:', error);
        }
    }

    stopCurrentAudio() {
        if (this.currentAudio) {
            this.currentAudio.pause();
            this.currentAudio = null;
        }
        if (this.currentAudioUrl) {
            URL.revokeObjectURL(this.currentAudioUrl);
            this.currentAudioUrl = null;
        }
    }

    /**
     * Prepare audio for playback (synthesis/loading phase).
     * Returns { play: () => Promise<void>, duration: number } or null.
     */
    async prepareAudio(text) {
        if (!this.audioStateMachine) return null;
        const mode = this.audioStateMachine.effectiveMode;

        if (mode === 'tts' && window.electronAPI?.ttsSynthesize) {
            try {
                const result = await window.electronAPI.ttsSynthesize(text);
                if (!result.success || !result.wav) return null;

                const audio = this._createAudioFromBase64(result.wav);
                // Wait for metadata to get duration
                const duration = await new Promise((resolve, reject) => {
                    audio.addEventListener('loadedmetadata', () => resolve(audio.duration * 1000));
                    audio.addEventListener('error', () => reject(new Error('audio load failed')));
                });

                return {
                    duration,
                    play: () => this._playPreparedAudio(audio)
                };
            } catch (e) {
                console.warn('[TTS] Prepare failed:', e.message);
                return null;
            }
        } else if (mode === 'default-audio') {
            const clip = this.audioStateMachine.getRandomClip();
            if (!clip) return null;
            const audio = clip.cloneNode();
            return {
                duration: 0, // unknown for default clips
                play: () => this._playPreparedAudio(audio)
            };
        }
        return null; // silent
    }

    _createAudioFromBase64(base64) {
        const wavBytes = Uint8Array.from(atob(base64), c => c.charCodeAt(0));
        const blob = new Blob([wavBytes], { type: 'audio/wav' });
        const url = URL.createObjectURL(blob);
        const audio = new Audio(url);
        audio._objectUrl = url;
        return audio;
    }

    /**
     * Play a prepared Audio element. Returns Promise that resolves when playback ends.
     */
    _playPreparedAudio(audio) {
        this.stopCurrentAudio();
        this.currentAudio = audio;
        this.currentAudioUrl = audio._objectUrl || null;
        return new Promise(resolve => {
            audio.addEventListener('ended', () => { this.stopCurrentAudio(); resolve(); });
            audio.addEventListener('error', () => { this.stopCurrentAudio(); resolve(); });
            audio.play().catch(() => { this.stopCurrentAudio(); resolve(); });
        });
    }

    shouldSkipApp(appName) {
        const skip = ['desktop-pet', 'electron'];
        return skip.some(s => appName.toLowerCase().includes(s));
    }

    // ========== Message Double-Buffer ==========

    async _processQueue() {
        if (this.isPlayingMessage) return;
        this.isPlayingMessage = true;

        while (this.pendingMessage && this.isActive) {
            // Grab latest and clear the slot
            const text = this.pendingMessage;
            this.pendingMessage = null;

            if (this.currentSession) this.currentSession.cancel();
            this.stopCurrentAudio();
            if (this.emotionSystem) this.emotionSystem.forceRevert();

            const session = MessageSession.create(text);
            this.currentSession = session;
            await session.run(this);

            // Wait minimum gap before playing next message
            if (this.chatGapMs > 0 && this.pendingMessage) {
                await new Promise(r => setTimeout(r, this.chatGapMs));
            }
        }

        this.isPlayingMessage = false;
    }

    async sendRequest(appName) {
        if (this.isRequesting) return;
        this.isRequesting = true;

        try {
            // Build fresh system prompt with dynamic context
            const dynamicContext = this.buildDynamicContext();
            const currentSystemPrompt = this.promptBuilder.buildSystemPrompt(dynamicContext);

            const textPrompt = this.promptBuilder.getAppDetectionPrompt(appName);

            // Only gather NEW (unsent) screenshots
            const windowScreenshots = (this.screenshotBuffers[appName] || []).filter(s => !s.sent);

            // Build messages: system + history + current user message
            const messages = [
                { role: 'system', content: currentSystemPrompt },
                ...this.conversationHistory
            ];

            let response;

            if (windowScreenshots.length > 0) {
                const now = new Date();
                const timeStr = `${now.getHours()}:${String(now.getMinutes()).padStart(2, '0')}`;
                const userContent = [
                    { type: 'text', text: `[${timeStr}] ${textPrompt}（附上屏幕截图）` }
                ];

                for (const screenshot of windowScreenshots) {
                    userContent.push({
                        type: 'image_url',
                        image_url: { url: 'data:image/jpeg;base64,' + screenshot.base64 }
                    });
                }

                messages.push({ role: 'user', content: userContent });
                response = await this.aiClient.callAPI(messages);

                // Mark sent and clear old screenshots for this window
                for (const screenshot of windowScreenshots) {
                    screenshot.sent = true;
                }
                this.screenshotBuffers[appName] = this.screenshotBuffers[appName].filter(s => !s.sent);
            } else {
                // No new screenshots — use idle prompt with timestamp
                const now = new Date();
                const timeStr = `${now.getHours()}:${String(now.getMinutes()).padStart(2, '0')}`;
                const idlePrompt = this.promptBuilder.getIdlePrompt();
                messages.push({ role: 'user', content: `[${timeStr}] ${idlePrompt}` });
                response = await this.aiClient.callAPI(messages);
            }

            if (response) {
                // Append to conversation history (text-only summary for user turn)
                const userSummary = windowScreenshots.length > 0
                    ? `（用户正在使用${appName}，已查看截图）`
                    : `（用户正在使用${appName}）`;
                this.conversationHistory.push(
                    { role: 'user', content: userSummary },
                    { role: 'assistant', content: response }
                );
                // Keep only last N pairs
                while (this.conversationHistory.length > this.maxHistoryPairs * 2) {
                    this.conversationHistory.splice(0, 2);
                }

                // Double-buffer: overwrite pending with latest
                this.pendingMessage = response;
                this._processQueue();
            }

            // Clear focus tracker after each AI request
            this.focusTracker = {};

        } catch (error) {
            console.error('[DesktopPetSystem] Request failed:', error);
        } finally {
            this.isRequesting = false;
        }
    }
}

window.DesktopPetSystem = DesktopPetSystem;
