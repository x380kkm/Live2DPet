// audience: internal
// # pet-chat-bubble
// 独立对话气泡窗口的渲染脚本:收发言文本、按文本量请主进程改窗口尺寸、定时淡出后请主进程隐藏。
// 不变量:只经 preload 暴露的 petBridge 窄接口与主进程通信,不直接碰 ipcRenderer;窗口尺寸与位置由主进程的气泡控制器定。

class PetChatBubble {
    constructor() {
        this.messageElement = document.getElementById('message-text');
        this.autoCloseTimer = null;
        // 渲染侧只见 petBridge:配置读取在 config 域,气泡消息订阅在 events 域,改尺寸与隐藏在 ui 域。
        const bridge = window.petBridge || {};
        this.config = bridge.config || {};
        this.ui = bridge.ui || {};
        this.events = bridge.events || {};
        this.init();
    }

    async init() {
        const frame = document.querySelector('.chat-frame');
        if (frame) frame.style.display = 'none';
        await this.loadBubbleFrame();
        this.setupEventListeners();
    }

    //// 读配置:给了自定义边框图就切到 framed 模式用整图作框,否则保持 CSS 原生气泡 [@busybee 2026-06-14] ////
    async loadBubbleFrame() {
        try {
            if (this.config.loadConfig) {
                const config = await this.config.loadConfig();
                if (config && config.bubble && config.bubble.frameImagePath) {
                    const frameBg = document.querySelector('.frame-bg');
                    const frame = document.querySelector('.chat-frame');
                    if (frameBg) frameBg.src = config.bubble.frameImagePath;
                    if (frame) frame.classList.add('framed');
                }
            }
        } catch (e) {
            console.warn('[Chat] 读气泡边框配置失败:', e && e.message);
        }
    }

    //// 订阅气泡消息通道,收到即显示 [@busybee 2026-06-14] ////
    setupEventListeners() {
        if (this.events.onChatBubbleMessage) {
            this.events.onChatBubbleMessage((data) => this.showMessage(data.message, data.autoCloseTime));
        }
    }

    //// 显示一条发言:写文本、量尺寸、淡入,到时淡出 [@busybee 2026-06-14] ////
    showMessage(message, autoCloseTime = 8000) {
        this.messageElement.textContent = message;
        this.messageElement.classList.remove('text-in');
        this.adjustWindowSize();
        if (this.autoCloseTimer) clearTimeout(this.autoCloseTimer);
        const frame = document.querySelector('.chat-frame');
        frame.style.display = 'flex';
        frame.classList.remove('fade-out');
        // 下一帧再触发文本淡入,使上面移除的类先生效
        requestAnimationFrame(() => this.messageElement.classList.add('text-in'));
        if (autoCloseTime > 0) {
            this.autoCloseTimer = setTimeout(() => this.fadeOut(), autoCloseTime);
        }
    }

    //// 按文本量算目标宽高,请主进程把气泡窗口改到该尺寸并重定位 [@busybee 2026-06-14] ////
    adjustWindowSize() {
        const textEl = this.messageElement;
        if (!textEl) return;
        requestAnimationFrame(() => {
            try {
                const rect = textEl.getBoundingClientRect();
                const width = Math.min(Math.max(160, Math.ceil(rect.width) + 50), 300);
                const height = Math.ceil(rect.height) + 60;
                if (this.ui.resizeChatBubble) this.ui.resizeChatBubble(width, height);
            } catch (error) {
                console.error('[Chat] 改尺寸失败:', error && error.message);
            }
        });
    }

    //// 淡出动画后请主进程隐藏气泡窗口 [@busybee 2026-06-14] ////
    fadeOut() {
        const frame = document.querySelector('.chat-frame');
        frame.classList.add('fade-out');
        setTimeout(() => {
            if (this.ui.closeChatBubble) this.ui.closeChatBubble();
        }, 300);
    }
}

document.addEventListener('DOMContentLoaded', () => new PetChatBubble());
