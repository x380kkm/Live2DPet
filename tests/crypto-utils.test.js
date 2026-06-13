/**
 * Unit tests for CryptoUtils
 * Run with: node --test tests/test-crypto-utils.js
 */
const { describe, it } = require('node:test');
const assert = require('node:assert');
const { encrypt, decrypt, isEncrypted, getMachineSeed } = require('../src/main/crypto-utils');

describe('CryptoUtils', () => {
    const seed = 'test-seed-for-unit-tests';

    it('encrypt then decrypt round-trips correctly', () => {
        const plaintext = 'sk-abc123-secret-key';
        const encrypted = encrypt(plaintext, seed);
        const decrypted = decrypt(encrypted, seed);
        assert.strictEqual(decrypted, plaintext);
    });

    it('decrypt of plaintext returns it unchanged (backward compat)', () => {
        assert.strictEqual(decrypt('sk-plaintext-key', seed), 'sk-plaintext-key');
    });

    it('isEncrypted correctly identifies encrypted values', () => {
        const encrypted = encrypt('test', seed);
        assert.strictEqual(isEncrypted(encrypted), true);
        assert.strictEqual(isEncrypted('plaintext'), false);
        assert.strictEqual(isEncrypted(''), false);
        assert.strictEqual(isEncrypted(null), false);
    });

    it('encrypt returns empty/null for empty/null input', () => {
        assert.strictEqual(encrypt('', seed), '');
        assert.strictEqual(encrypt(null, seed), null);
        assert.strictEqual(encrypt(undefined, seed), undefined);
    });

    it('decrypt returns empty/null for empty/null input', () => {
        assert.strictEqual(decrypt('', seed), '');
        assert.strictEqual(decrypt(null, seed), null);
    });

    it('different plaintext produces different ciphertext', () => {
        const a = encrypt('key-a', seed);
        const b = encrypt('key-b', seed);
        assert.notStrictEqual(a, b);
    });

    it('same plaintext produces different ciphertext (random IV)', () => {
        const a = encrypt('same-key', seed);
        const b = encrypt('same-key', seed);
        assert.notStrictEqual(a, b);
        // But both decrypt to the same value
        assert.strictEqual(decrypt(a, seed), 'same-key');
        assert.strictEqual(decrypt(b, seed), 'same-key');
    });

    it('getMachineSeed returns a non-empty string', () => {
        const seed = getMachineSeed();
        assert.strictEqual(typeof seed, 'string');
        assert.ok(seed.length > 0);
        assert.ok(seed.startsWith('live2dpet-'));
    });

    it('encrypted format has correct prefix', () => {
        const encrypted = encrypt('test', seed);
        assert.ok(encrypted.startsWith('enc:v1:'));
        const parts = encrypted.slice(7).split(':');
        assert.strictEqual(parts.length, 3); // iv:tag:ciphertext
    });
});
