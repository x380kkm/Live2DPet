// audience: internal
// # settings-app.test
// 验证设置面板组合根的纯逻辑:i18n 三级回退、状态类名映射、整体落盘委托给网关。
// DOM 与 window 接口用最小 mock 注入,只校验状态映射,不验证真实渲染。

const { test } = require('node:test');
const assert = require('node:assert');

// settings-app 是 ESM(渲染侧),用动态 import 载入。
const loadApp = () => import('../../src/renderer/settings/settings-app.js');

//// 造一个最小文档 mock:支撑 getElementById、querySelectorAll 与元素属性读写 [@x380kkm 2026-06-13] ////
function mockDoc() {
  const elements = {};
  function makeEl(id) {
    return {
      id, value: '', textContent: '', placeholder: '', className: '', dataset: {},
      style: {}, checked: false,
      addEventListener() {},
      classList: { add() {}, remove() {} }
    };
  }
  return {
    elements,
    getElementById(id) {
      if (!elements[id]) elements[id] = makeEl(id);
      return elements[id];
    },
    querySelectorAll() { return []; },
    querySelector() { return null; },
    createElement() { return makeEl('created'); }
  };
}

test('t 命中当前语言', async () => {
  const { SettingsApp } = await loadApp();
  const app = new SettingsApp({ doc: mockDoc(), i18n: { en: { 'k': 'EN' }, zh: { 'k': 'ZH' } } });
  app.currentLang = 'zh';
  assert.strictEqual(app.t('k'), 'ZH');
});

test('t 当前语言缺键时回退英文', async () => {
  const { SettingsApp } = await loadApp();
  const app = new SettingsApp({ doc: mockDoc(), i18n: { en: { 'k': 'EN' }, zh: {} } });
  app.currentLang = 'zh';
  assert.strictEqual(app.t('k'), 'EN');
});

test('t 两层都缺时回退键名本身', async () => {
  const { SettingsApp } = await loadApp();
  const app = new SettingsApp({ doc: mockDoc(), i18n: { en: {} } });
  assert.strictEqual(app.t('missing.key'), 'missing.key');
});

test('_showStatus 把消息与类型映射到元素文本与类名', async () => {
  const { SettingsApp } = await loadApp();
  const doc = mockDoc();
  const app = new SettingsApp({ doc });
  app._showStatus('api-status', '已保存', 'success');
  const el = doc.getElementById('api-status');
  assert.strictEqual(el.textContent, '已保存');
  assert.strictEqual(el.className, 'status success');
});

test('_applyLanguage 已知语言切换,未知语言维持英文', async () => {
  const { SettingsApp } = await loadApp();
  const app = new SettingsApp({ doc: mockDoc(), i18n: { en: {}, zh: {} } });
  app._applyLanguage('zh');
  assert.strictEqual(app.currentLang, 'zh');
  app._applyLanguage('xx');
  assert.strictEqual(app.currentLang, 'zh');
});

test('save 把数据模型整体委托给配置网关', async () => {
  const { SettingsApp } = await loadApp();
  const saved = [];
  const electronApi = { loadConfig: async () => ({ model: { type: 'live2d' } }), saveConfig: async (patch) => { saved.push(patch); } };
  const app = new SettingsApp({ doc: mockDoc(), electronApi });
  await app.load();
  const ok = await app.save();
  assert.strictEqual(ok, true);
  assert.strictEqual(saved.length, 1);
  assert.strictEqual(saved[0].model.type, 'live2d');
});

test('save 在未载入模型时返回 false 且不落盘', async () => {
  const { SettingsApp } = await loadApp();
  const saved = [];
  const electronApi = { saveConfig: async (patch) => { saved.push(patch); } };
  const app = new SettingsApp({ doc: mockDoc(), electronApi });
  const ok = await app.save();
  assert.strictEqual(ok, false);
  assert.strictEqual(saved.length, 0);
});

test('load 从网关读配置建模', async () => {
  const { SettingsApp } = await loadApp();
  const electronApi = { loadConfig: async () => ({ baseURL: 'https://x', model: { type: 'image' } }) };
  const app = new SettingsApp({ doc: mockDoc(), electronApi });
  const model = await app.load();
  assert.strictEqual(model.config.baseURL, 'https://x');
  assert.strictEqual(model.model().type, 'image');
});
