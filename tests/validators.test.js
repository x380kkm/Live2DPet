/**
 * Unit tests for Validators
 * Run with: node --test tests/test-validators.js
 */
const { describe, it } = require('node:test');
const assert = require('node:assert');
const { isValidUUID, isValidURL, sanitizePath } = require('../src/main/validators');

describe('isValidUUID', () => {
    it('accepts valid UUID', () => {
        assert.strictEqual(isValidUUID('2bcf3d8a-85e8-47dd-aa07-792fe91cca26'), true);
    });

    it('rejects non-UUID strings', () => {
        assert.strictEqual(isValidUUID('not-a-uuid'), false);
        assert.strictEqual(isValidUUID(''), false);
        assert.strictEqual(isValidUUID(null), false);
        assert.strictEqual(isValidUUID(123), false);
    });

    it('rejects path traversal attempts', () => {
        assert.strictEqual(isValidUUID('../../etc/passwd'), false);
        assert.strictEqual(isValidUUID('../config.json'), false);
    });
});

describe('isValidURL', () => {
    it('accepts http and https URLs', () => {
        assert.strictEqual(isValidURL('https://example.com'), true);
        assert.strictEqual(isValidURL('http://localhost:3000'), true);
    });

    it('rejects non-http protocols', () => {
        assert.strictEqual(isValidURL('file:///etc/passwd'), false);
        assert.strictEqual(isValidURL('javascript:alert(1)'), false);
        assert.strictEqual(isValidURL('ftp://example.com'), false);
    });

    it('rejects invalid URLs', () => {
        assert.strictEqual(isValidURL('not a url'), false);
        assert.strictEqual(isValidURL(''), false);
    });
});

describe('sanitizePath', () => {
    it('accepts paths within base directory', () => {
        const result = sanitizePath('/app/data', 'models/test');
        assert.ok(result.includes('models'));
    });

    it('rejects path traversal', () => {
        assert.throws(() => sanitizePath('/app/data', '../../etc/passwd'), /Path traversal/);
        assert.throws(() => sanitizePath('/app/data', '../../../'), /Path traversal/);
    });
});
