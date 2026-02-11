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

        // Screenshot buffer system (5s interval, per-window)
        this.screenshotTimer = null;
        this.screenshotBuffers = {};
        this.maxScreenshotsPerWindow = 3;

        // Window focus tracking (1s sampling, cleared after each AI request)
        this.focusTimer = null;
        this.focusTracker = {};
    }

    async init() {
        this.aiClient = new AIChatClient();
        await this.aiClient.init();

        this.promptBuilder = new PetPromptBuilder();
        await this.promptBuilder.init();

        this.systemPrompt = this.promptBuilder.buildSystemPrompt();

        this.emotionSystem = new EmotionSystem(this);
        await this.emotionSystem.loadConfig();

        console.log('[DesktopPetSystem] Initialized');
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
        this.emotionSystem.stop();
        try {
            await window.electronAPI.closePetWindow();
        } catch (e) {}
        this.isActive = false;
        this.focusTracker = {};
        this.screenshotBuffers = {};
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

    shouldSkipApp(appName) {
        const skip = ['desktop-pet', 'electron'];
        return skip.some(s => appName.toLowerCase().includes(s));
    }

    async sendRequest(appName) {
        if (this.isRequesting) return;
        this.isRequesting = true;

        try {
            // Build fresh system prompt with dynamic context
            const dynamicContext = this.buildDynamicContext();
            const currentSystemPrompt = this.promptBuilder.buildSystemPrompt(dynamicContext);

            const textPrompt = this.promptBuilder.getAppDetectionPrompt(appName);

            // Gather screenshots for the current window from the buffer
            const windowScreenshots = this.screenshotBuffers[appName] || [];

            let response;

            if (windowScreenshots.length > 0) {
                // Build user content with multiple screenshots
                const userContent = [
                    { type: 'text', text: textPrompt + '（附上当前屏幕截图，请根据看到的内容自然回应）' }
                ];

                for (const screenshot of windowScreenshots) {
                    const annotation = screenshot.sent
                        ? '（这张截图你之前已经看过，不需要重复关注）'
                        : '（新截图）';
                    userContent.push({ type: 'text', text: annotation });
                    userContent.push({
                        type: 'image_url',
                        image_url: { url: 'data:image/jpeg;base64,' + screenshot.base64 }
                    });
                }

                const messages = [
                    { role: 'system', content: currentSystemPrompt },
                    { role: 'user', content: userContent }
                ];
                response = await this.aiClient.callAPI(messages);

                // Mark all included screenshots as sent
                for (const screenshot of windowScreenshots) {
                    screenshot.sent = true;
                }
            } else {
                // No screenshots available - text-only fallback
                const messages = [
                    { role: 'system', content: currentSystemPrompt },
                    { role: 'user', content: textPrompt }
                ];
                response = await this.aiClient.callAPI(messages);
            }

            if (response) {
                await window.electronAPI.showPetChat(response, 8000);
                console.log('[DesktopPetSystem] Response:', response);

                if (this.emotionSystem) {
                    this.emotionSystem.onAIResponse(response);
                }
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
