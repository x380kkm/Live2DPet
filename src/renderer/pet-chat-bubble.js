class PetChatBubble {
    constructor() {
        this.messageElement = document.getElementById('message-text');
        this.autoCloseTimer = null;
        this.init();
    }

    async init() {
        const frame = document.querySelector('.chat-frame');
        if (frame) frame.style.display = 'none';
        // Load custom bubble frame from config
        await this.loadBubbleFrame();
        this.setupEventListeners();
    }

    async loadBubbleFrame() {
        try {
            if (window.electronAPI && window.electronAPI.loadConfig) {
                const config = await window.electronAPI.loadConfig();
                if (config.bubble && config.bubble.frameImagePath) {
                    const frameBg = document.querySelector('.frame-bg');
                    if (frameBg) frameBg.src = config.bubble.frameImagePath;
                }
            }
        } catch (e) {
            console.warn('[Chat] Failed to load bubble config:', e);
        }
    }

    setupEventListeners() {
        if (window.electronAPI && window.electronAPI.onChatBubbleMessage) {
            window.electronAPI.onChatBubbleMessage(data => {
                this.showMessage(data.message, data.autoCloseTime);
            });
        }
    }

    showMessage(message, autoCloseTime = 8000) {
        this.messageElement.textContent = message;
        this.adjustWindowSize(message);
        if (this.autoCloseTimer) clearTimeout(this.autoCloseTimer);
        const frame = document.querySelector('.chat-frame');
        frame.style.display = 'flex';
        frame.classList.remove('fade-out');
        if (autoCloseTime > 0) {
            this.autoCloseTimer = setTimeout(() => this.fadeOut(), autoCloseTime);
        }
    }

    adjustWindowSize(message) {
        try {
            const textEl = this.messageElement;
            if (!textEl) return;
            requestAnimationFrame(() => {
                const rect = textEl.getBoundingClientRect();
                const width = Math.min(Math.max(160, Math.ceil(rect.width) + 50), 300);
                const height = Math.ceil(rect.height) + 60;
                if (window.electronAPI && window.electronAPI.resizeChatBubble) {
                    window.electronAPI.resizeChatBubble(width, height);
                }
            });
        } catch (error) {
            console.error('[Chat] resize failed:', error.message);
        }
    }

    fadeOut() {
        const frame = document.querySelector('.chat-frame');
        frame.classList.add('fade-out');
        setTimeout(() => {
            if (window.electronAPI && window.electronAPI.closeChatBubble) {
                window.electronAPI.closeChatBubble();
            } else {
                window.close();
            }
        }, 300);
    }
}

document.addEventListener('DOMContentLoaded', () => new PetChatBubble());
