// 验证 ui-handlers 的契约:气泡推送、上下文菜单、开发者工具、角色数据均经窗口句柄与菜单工厂,不裸 send;死窗口被过滤。
const { test } = require('node:test');
const assert = require('node:assert');

const router = require('../../../src/platform/ipc/ipc-router');
const { createWindow, isAlive } = require('../../../src/platform/electron/window-factory');
const { createMenuPopup } = require('../../../src/platform/electron/tray-factory');
const { registerUiHandlers, RENDER_CHANNEL, PET_SIZES } = require('../../../src/platform/ipc/handlers/ui-handlers');

// 造一个记录调用、可标记销毁的假 BrowserWindow 类,代替真实 electron 类型 [@busybee 2026-06-13]
function makeFakeBrowserWindowClass() {
  const instances = [];
  class FakeBrowserWindow {
    constructor() {
      this.destroyed = false;
      this.calls = [];
      this.sent = [];
      this.devToolsOpened = 0;
      this.webContents = { send: (channel, payload) => this.sent.push({ channel, payload }), openDevTools: () => { this.devToolsOpened++; } };
      instances.push(this);
    }
    setSize(w, h) { this.calls.push(['setSize', w, h]); }
    show() { this.calls.push(['show']); }
    focus() { this.calls.push(['focus']); }
    close() { this.calls.push(['close']); }
    isDestroyed() { return this.destroyed; }
  }
  return { FakeBrowserWindow, instances };
}

// 造一个记录弹出模板与目标的假 Menu 类,经真实 createMenuPopup 包装 [@busybee 2026-06-13]
function makeMenuPopup() {
  const popped = [];
  const Menu = {
    buildFromTemplate(template) {
      return { popup: (opts) => { popped.push({ template, window: opts.window }); } };
    }
  };
  return { popup: createMenuPopup({ Menu }), popped };
}

// 把真实 router、真实窗口工厂与菜单工厂装好,注入取窗口的取值函数与翻译 [@busybee 2026-06-13]
function setup(opts = {}) {
  router.reset();
  const { FakeBrowserWindow, instances } = makeFakeBrowserWindowClass();
  const pet = opts.noPet ? null : createWindow({ BrowserWindow: FakeBrowserWindow });
  const settings = opts.noSettings ? null : createWindow({ BrowserWindow: FakeBrowserWindow });
  const menu = makeMenuPopup();
  const created = [];
  registerUiHandlers({
    router,
    getPetWindow: () => pet,
    getSettingsWindow: () => settings,
    createSettingsWindow: () => { created.push(true); },
    menuPopup: menu.popup,
    isAlive,
    mt: (key) => `t:${key}`,
    initialCharacterData: opts.initialCharacterData
  });
  return { pet, settings, menu, created, instances };
}

// 取一个窗口句柄底层假实例,断言其推送与调用 [@busybee 2026-06-13]
function rawOf(handle) {
  return handle._raw;
}

test('show-pet-chat 把文本推进宠物窗口舞台气泡', async () => {
  const { pet } = setup();
  const result = await router.dispatch('show-pet-chat', ['hi', 3000]);
  assert.deepStrictEqual(result, { success: true });
  assert.deepStrictEqual(rawOf(pet).sent, [{ channel: RENDER_CHANNEL.bubbleMessage, payload: { message: 'hi', autoCloseTime: 3000 } }]);
});

test('show-pet-chat 缺自动关闭时间时回退到默认 8000', async () => {
  const { pet } = setup();
  await router.dispatch('show-pet-chat', ['hello']);
  assert.strictEqual(rawOf(pet).sent[0].payload.autoCloseTime, 8000);
});

test('show-pet-chat 无宠物窗口时报失败', async () => {
  setup({ noPet: true });
  const result = await router.dispatch('show-pet-chat', ['hi']);
  assert.strictEqual(result.success, false);
  assert.match(result.error, /no pet window/);
});

test('close-chat-bubble 通知宠物窗口收起气泡', async () => {
  const { pet } = setup();
  const result = await router.dispatch('close-chat-bubble', undefined);
  assert.deepStrictEqual(result, { success: true });
  assert.deepStrictEqual(rawOf(pet).sent, [{ channel: RENDER_CHANNEL.bubbleClose, payload: null }]);
});

test('close-chat-bubble 无宠物窗口时仍回成功且不推送', async () => {
  setup({ noPet: true });
  const result = await router.dispatch('close-chat-bubble', undefined);
  assert.deepStrictEqual(result, { success: true });
});

test('resize-chat-bubble 把目标宽高推给宠物窗口', async () => {
  const { pet } = setup();
  const result = await router.dispatch('resize-chat-bubble', [250, 90]);
  assert.deepStrictEqual(result, { success: true });
  assert.deepStrictEqual(rawOf(pet).sent, [{ channel: RENDER_CHANNEL.bubbleResize, payload: { width: 250, height: 90 } }]);
});

test('show-pet-context-menu 经菜单工厂弹在宠物窗口上,且模板含全部尺寸项', async () => {
  const { pet, menu } = setup();
  const result = await router.dispatch('show-pet-context-menu', undefined);
  assert.deepStrictEqual(result, { success: true });
  assert.strictEqual(menu.popped.length, 1);
  // 弹出目标解到宠物窗口底层实例,业务侧不见 _raw
  assert.strictEqual(menu.popped[0].window, rawOf(pet));
  const template = menu.popped[0].template;
  const sizeItem = template.find((it) => it.label === 't:main.size');
  assert.ok(sizeItem, '应有尺寸子菜单项');
  assert.deepStrictEqual(sizeItem.submenu.map((it) => it.label), PET_SIZES.map((s) => `${s}x${s}`));
});

test('show-pet-context-menu 的尺寸项点击改窗尺寸并回报渲染侧', async () => {
  const { pet, menu } = setup();
  await router.dispatch('show-pet-context-menu', undefined);
  const sizeItem = menu.popped[0].template.find((it) => it.label === 't:main.size');
  sizeItem.submenu[1].click();
  assert.ok(rawOf(pet).calls.some((c) => c[0] === 'setSize' && c[1] === PET_SIZES[1] && c[2] === PET_SIZES[1]));
  assert.deepStrictEqual(rawOf(pet).sent.at(-1), { channel: RENDER_CHANNEL.sizeChanged, payload: PET_SIZES[1] });
});

test('show-pet-context-menu 的设置项显示已存在的设置窗口', async () => {
  const { settings, menu, created } = setup();
  await router.dispatch('show-pet-context-menu', undefined);
  const settingsItem = menu.popped[0].template.find((it) => it.label === 't:main.settings');
  settingsItem.click();
  assert.ok(rawOf(settings).calls.some((c) => c[0] === 'show'));
  assert.ok(rawOf(settings).calls.some((c) => c[0] === 'focus'));
  assert.strictEqual(created.length, 0);
});

test('show-pet-context-menu 的设置项在设置窗口缺失时新建', async () => {
  const { menu, created } = setup({ noSettings: true });
  await router.dispatch('show-pet-context-menu', undefined);
  const settingsItem = menu.popped[0].template.find((it) => it.label === 't:main.settings');
  settingsItem.click();
  assert.strictEqual(created.length, 1);
});

test('show-pet-context-menu 的关闭项关掉宠物窗口', async () => {
  const { pet, menu } = setup();
  await router.dispatch('show-pet-context-menu', undefined);
  const closeItem = menu.popped[0].template.find((it) => it.label === 't:main.close');
  closeItem.click();
  assert.ok(rawOf(pet).calls.some((c) => c[0] === 'close'));
});

test('show-pet-context-menu 无宠物窗口时报失败且不弹菜单', async () => {
  const { menu } = setup({ noPet: true });
  const result = await router.dispatch('show-pet-context-menu', undefined);
  assert.strictEqual(result.success, false);
  assert.strictEqual(menu.popped.length, 0);
});

test('open-dev-tools 在宠物窗口打开开发者工具', async () => {
  const { pet } = setup();
  const result = await router.dispatch('open-dev-tools', undefined);
  assert.deepStrictEqual(result, { success: true });
  assert.strictEqual(rawOf(pet).devToolsOpened, 1);
});

test('open-dev-tools 无宠物窗口时仍回成功', async () => {
  setup({ noPet: true });
  const result = await router.dispatch('open-dev-tools', undefined);
  assert.deepStrictEqual(result, { success: true });
});

test('update-pet-character 合并补丁并把快照推给宠物窗口', async () => {
  const { pet } = setup({ initialCharacterData: { name: 'A', mood: 'calm' } });
  const result = await router.dispatch('update-pet-character', { mood: 'happy' });
  assert.deepStrictEqual(result, { success: true });
  assert.deepStrictEqual(rawOf(pet).sent, [{ channel: RENDER_CHANNEL.characterUpdate, payload: { name: 'A', mood: 'happy' } }]);
});

test('update-pet-character 的合并对后续 get-character-data 可见', async () => {
  setup({ initialCharacterData: { name: 'A' } });
  await router.dispatch('update-pet-character', { name: 'B', extra: 1 });
  const data = await router.dispatch('get-character-data', undefined);
  assert.deepStrictEqual(data, { name: 'B', extra: 1 });
});

test('get-character-data 在无更新时返回初值快照', async () => {
  setup({ initialCharacterData: { name: 'init' } });
  const data = await router.dispatch('get-character-data', undefined);
  assert.deepStrictEqual(data, { name: 'init' });
});

test('get-character-data 缺初值时返回空对象', async () => {
  setup();
  const data = await router.dispatch('get-character-data', undefined);
  assert.deepStrictEqual(data, {});
});

test('宠物窗口已销毁时气泡推送与开发者工具被过滤', async () => {
  const { pet } = setup();
  rawOf(pet).destroyed = true;
  await router.dispatch('show-pet-chat', ['hi']);
  await router.dispatch('open-dev-tools', undefined);
  assert.strictEqual(rawOf(pet).sent.length, 0);
  assert.strictEqual(rawOf(pet).devToolsOpened, 0);
});
