// audience: internal
// # crypto-utils
// 用 AES-256-GCM 加解密 API 密钥,供配置持久化使用;密钥由机器信息经 PBKDF2 派生。
// 向后兼容:明文值经 decrypt() 原样透传。
const crypto = require('crypto');
const os = require('os');

const SALT = Buffer.from('live2dpet-config-encryption-salt');
const PREFIX = 'enc:v1:';

function getMachineSeed() {
    return `live2dpet-${os.hostname()}-${os.userInfo().username}`;
}

function deriveKey(seed) {
    return crypto.pbkdf2Sync(seed || getMachineSeed(), SALT, 100000, 32, 'sha256');
}

function encrypt(plaintext, seed) {
    if (!plaintext) return plaintext;
    const key = deriveKey(seed);
    const iv = crypto.randomBytes(12);
    const cipher = crypto.createCipheriv('aes-256-gcm', key, iv);
    const encrypted = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
    const tag = cipher.getAuthTag();
    return `${PREFIX}${iv.toString('hex')}:${tag.toString('hex')}:${encrypted.toString('hex')}`;
}

function decrypt(value, seed) {
    if (!value) return value;
    if (!isEncrypted(value)) return value;
    const parts = value.slice(PREFIX.length).split(':');
    if (parts.length !== 3) return value;
    const iv = Buffer.from(parts[0], 'hex');
    const tag = Buffer.from(parts[1], 'hex');
    const encrypted = Buffer.from(parts[2], 'hex');
    const key = deriveKey(seed);
    const decipher = crypto.createDecipheriv('aes-256-gcm', key, iv);
    decipher.setAuthTag(tag);
    return decipher.update(encrypted, null, 'utf8') + decipher.final('utf8');
}

function isEncrypted(value) {
    return typeof value === 'string' && value.startsWith(PREFIX);
}

module.exports = { encrypt, decrypt, isEncrypted, getMachineSeed };
