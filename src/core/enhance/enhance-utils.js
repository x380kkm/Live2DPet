/**
 * Enhance Utils — Shared helpers for enhancement modules
 * Must load after context-pool.js (uses STOP_WORDS) and before other enhance modules
 */

function enhanceT(key) {
    if (typeof window !== 'undefined' && window.I18N) {
        const lang = window._enhanceLang || 'en';
        return window.I18N[lang]?.[key] || window.I18N['en']?.[key] || key;
    }
    return key;
}

function enhanceLang() {
    return window._enhanceLang || 'en';
}

function enhanceLangName() {
    const map = { en: 'English', zh: '中文', ja: '日本語' };
    return map[enhanceLang()] || 'English';
}

/**
 * Sanitize text by masking long alphanumeric sequences (likely keys/passwords/tokens).
 * Sequences of 20+ alphanumeric chars (including - and _) are replaced with [***].
 */
function sanitizeSecrets(text) {
    if (!text || typeof text !== 'string') return text;
    return text.replace(/[A-Za-z0-9_-]{20,}/g, '[***]');
}

function isNoiseTitle(title) {
    if (!title || title.length < 3) return true;
    const noise = ['new tab', 'desktop', 'untitled', '新标签页', '新しいタブ', 'start',
        'system tray overflow', '系统托盘溢出', 'システムトレイ'];
    return noise.some(n => title.toLowerCase().includes(n));
}

function tokenizeTitle(title) {
    return title.toLowerCase()
        .replace(/\s*[-–—]\s*(个人|personal|個人用)\s*[-–—]\s*microsoft\s*edge\s*/gi, '')
        .replace(/\s*和另外\s*\d+\s*个页面\s*/g, '')
        .replace(/\s*and\s+\d+\s+more\s+pages?\s*/gi, '')
        .replace(/\s*他\s*\d+\s*件のページ\s*/g, '')
        .replace(/[-–—|·:：]/g, ' ')
        .split(/\s+/)
        .filter(w => w.length > 1 && !STOP_WORDS.has(w));
}

if (typeof window !== 'undefined') {
    window.enhanceT = enhanceT;
    window.enhanceLang = enhanceLang;
    window.enhanceLangName = enhanceLangName;
    window.sanitizeSecrets = sanitizeSecrets;
    window.isNoiseTitle = isNoiseTitle;
    window.tokenizeTitle = tokenizeTitle;
}
