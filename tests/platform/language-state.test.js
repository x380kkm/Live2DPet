// 运行:node --test tests/platform/language-state.test.js
// 验证当前语言载体:get/set 当前语言;mt 查当前语言、回退 en、再回退原 key;默认从真实 locales 表取。
const { test } = require('node:test');
const assert = require('node:assert');
const { LanguageState } = require('../../src/platform/config/language-state');

// 一张最小注入表:zh 缺 only.en 键,ja 整张缺失,用于验证逐级回退
const TABLE = {
  en: { 'k': 'EN', 'only.en': 'ONLY-EN' },
  zh: { 'k': 'ZH' }
};

test('get/set 读写当前语言代码', () => {
  const state = new LanguageState({ table: TABLE, lang: 'en' });
  assert.strictEqual(state.get(), 'en');
  state.set('zh');
  assert.strictEqual(state.get(), 'zh');
});

test('set 传入空值时保留原语言', () => {
  const state = new LanguageState({ table: TABLE, lang: 'zh' });
  state.set('');
  assert.strictEqual(state.get(), 'zh');
});

test('mt 命中当前语言译文', () => {
  const state = new LanguageState({ table: TABLE, lang: 'zh' });
  assert.strictEqual(state.mt('k'), 'ZH');
});

test('mt 当前语言缺该键时回退 en', () => {
  const state = new LanguageState({ table: TABLE, lang: 'zh' });
  assert.strictEqual(state.mt('only.en'), 'ONLY-EN');
});

test('mt 当前语言整张缺失时回退 en', () => {
  const state = new LanguageState({ table: TABLE, lang: 'ja' });
  assert.strictEqual(state.mt('k'), 'EN');
});

test('mt 当前语言与回退都缺该键时返回原 key', () => {
  const state = new LanguageState({ table: TABLE, lang: 'zh' });
  assert.strictEqual(state.mt('missing.key'), 'missing.key');
});

test('默认从真实 locales 表取,en 译出已知键', () => {
  const state = new LanguageState();
  assert.strictEqual(state.get(), 'en');
  assert.strictEqual(state.mt('btn.save'), 'Save');
  state.set('zh');
  assert.strictEqual(state.mt('btn.save'), '保存');
});
