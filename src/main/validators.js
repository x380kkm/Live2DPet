// audience: internal
// # validators
// IPC 处理器的输入校验工具,校验 UUID、URL 与路径。
const path = require('path');

function isValidUUID(str) {
    return typeof str === 'string' &&
        /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(str);
}

function isValidURL(str) {
    try {
        const u = new URL(str);
        return ['http:', 'https:'].includes(u.protocol);
    } catch { return false; }
}

function sanitizePath(basePath, userPath) {
    const resolved = path.resolve(basePath, userPath);
    if (!resolved.startsWith(path.resolve(basePath))) {
        throw new Error('Path traversal detected');
    }
    return resolved;
}

module.exports = { isValidUUID, isValidURL, sanitizePath };
