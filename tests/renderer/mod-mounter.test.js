// audience: internal
// # mod-mounter.test
// 验证 mod 承载:纯数据渲染、按钮点击产出交互事件、沙箱 iframe 的受限属性、来自沙箱的消息白名单过滤。
// 用最小假 DOM 与假 window,不触真实浏览器。

const { test } = require('node:test');
const assert = require('node:assert');

const loadMounter = () => import('../../src/renderer/mod/mod-mounter.js');

// 最小假 DOM:元素带 setAttribute、style、appendChild/removeChild、addEventListener 与 click 触发。
function makeFakeDoc() {
  const doc = { defaultView: null };
  doc.createElement = (tag) => {
    const el = {
      tagName: tag, children: [], attrs: {}, style: {}, _listeners: {},
      className: '', textContent: '', srcdoc: undefined,
      contentWindow: { tag, marker: 'iframe-window' },
      ownerDocument: doc,
      get firstChild() { return this.children[0] || null; },
      setAttribute(k, v) { this.attrs[k] = v; },
      getAttribute(k) { return this.attrs[k]; },
      appendChild(c) { this.children.push(c); c.parentNode = this; return c; },
      removeChild(c) { const i = this.children.indexOf(c); if (i >= 0) this.children.splice(i, 1); return c; },
      addEventListener(type, fn) { (this._listeners[type] = this._listeners[type] || []).push(fn); },
      click() { (this._listeners.click || []).forEach((f) => f()); }
    };
    return el;
  };
  return doc;
}
// 假 window:捕获 message 监听供手动触发。
function makeFakeView() {
  const listeners = {};
  return {
    listeners,
    addEventListener(type, fn) { (listeners[type] = listeners[type] || []).push(fn); },
    removeEventListener(type, fn) { const a = listeners[type] || []; const i = a.indexOf(fn); if (i >= 0) a.splice(i, 1); },
    fire(type, event) { (listeners[type] || []).forEach((f) => f(event)); }
  };
}

//// isSandboxed 与 buildSandboxFrame:可执行档判定与受限 iframe 属性 [@busybee 2026-06-14] ////
test('isSandboxed 仅 kind 为 sandboxed 时为真', async () => {
  const { isSandboxed } = await loadMounter();
  assert.strictEqual(isSandboxed({ kind: 'sandboxed' }), true);
  assert.strictEqual(isSandboxed({ kind: 'panel' }), false);
  assert.strictEqual(isSandboxed(null), false);
});

test('buildSandboxFrame 只给 allow-scripts、不给 allow-same-origin,srcdoc 载入', async () => {
  const { buildSandboxFrame } = await loadMounter();
  const doc = makeFakeDoc();
  const iframe = buildSandboxFrame({ kind: 'sandboxed', srcdoc: '<p>hi</p>' }, doc);
  assert.strictEqual(iframe.getAttribute('sandbox'), 'allow-scripts');
  assert.ok(!String(iframe.getAttribute('sandbox')).includes('allow-same-origin'));
  assert.strictEqual(iframe.srcdoc, '<p>hi</p>');
});
//// /isSandboxed 与 buildSandboxFrame ////

//// renderPureData:声明模板渲成 DOM,按钮点击产出交互事件 [@busybee 2026-06-14] ////
test('renderPureData 渲出标题、文本与按钮,按钮点击经 emit 带事件名与载荷', async () => {
  const { renderPureData } = await loadMounter();
  const doc = makeFakeDoc();
  const emitted = [];
  const spec = {
    title: '小游戏',
    items: [
      { type: 'text', text: '准备好了吗' },
      { type: 'button', label: '开始', event: 'game-start', payload: { level: 1 } }
    ]
  };
  const panel = renderPureData(spec, doc, (name, payload) => emitted.push([name, payload]));
  // 标题、文本、按钮各一个子元素
  assert.strictEqual(panel.children.length, 3);
  assert.strictEqual(panel.children[0].textContent, '小游戏');
  const button = panel.children[2];
  assert.strictEqual(button.tagName, 'button');
  button.click();
  assert.deepStrictEqual(emitted, [['game-start', { level: 1 }]]);
});
//// /renderPureData ////

//// allowedInteraction:沙箱消息白名单过滤 [@busybee 2026-06-14] ////
test('allowedInteraction 放行白名单内的交互事件,拒绝白名单外与非交互消息', async () => {
  const { allowedInteraction } = await loadMounter();
  const emits = ['click', 'win'];
  assert.deepStrictEqual(allowedInteraction({ type: 'mod-event', name: 'click', payload: { x: 1 } }, emits), { name: 'click', payload: { x: 1 } });
  assert.strictEqual(allowedInteraction({ type: 'mod-event', name: 'hack' }, emits), null);
  assert.strictEqual(allowedInteraction({ type: 'other', name: 'click' }, emits), null);
  assert.strictEqual(allowedInteraction({ type: 'mod-event', name: 'click' }, []), null);
});
//// /allowedInteraction ////

//// mountMod:纯数据直渲、沙箱桥接白名单内消息、忽略别处来源 [@busybee 2026-06-14] ////
test('mountMod 纯数据档把面板挂入根,按钮点击 emit', async () => {
  const { mountMod } = await loadMounter();
  const doc = makeFakeDoc();
  const root = doc.createElement('div');
  const emitted = [];
  mountMod(root, {
    frontendSpec: { kind: 'panel', title: 'T', items: [{ type: 'button', label: 'go', event: 'go' }] }
  }, { emit: (n, p) => emitted.push([n, p]), view: makeFakeView() });
  assert.strictEqual(root.children.length, 1);
  root.children[0].children[1].click(); // 标题后的按钮
  assert.deepStrictEqual(emitted, [['go', {}]]);
});

test('mountMod 沙箱档挂 iframe,只转白名单内且来自该 iframe 的消息', async () => {
  const { mountMod } = await loadMounter();
  const doc = makeFakeDoc();
  const root = doc.createElement('div');
  const view = makeFakeView();
  const emitted = [];
  mountMod(root, {
    frontendSpec: { kind: 'sandboxed', srcdoc: '<script>/* game */</' + 'script>' },
    emits: ['win']
  }, { emit: (n, p) => emitted.push([n, p]), view });
  const iframe = root.children[0];
  assert.strictEqual(iframe.tagName, 'iframe');
  // 来自该 iframe 的白名单内事件:转 emit
  view.fire('message', { source: iframe.contentWindow, data: { type: 'mod-event', name: 'win', payload: { score: 9 } } });
  // 白名单外事件:丢弃
  view.fire('message', { source: iframe.contentWindow, data: { type: 'mod-event', name: 'evil' } });
  // 来自别处窗口的事件:忽略
  view.fire('message', { source: { other: true }, data: { type: 'mod-event', name: 'win' } });
  assert.deepStrictEqual(emitted, [['win', { score: 9 }]]);
});

test('mountMod 返回的卸载函数摘除沙箱消息监听', async () => {
  const { mountMod } = await loadMounter();
  const doc = makeFakeDoc();
  const root = doc.createElement('div');
  const view = makeFakeView();
  const emitted = [];
  const unmount = mountMod(root, {
    frontendSpec: { kind: 'sandboxed', srcdoc: '' }, emits: ['win']
  }, { emit: (n, p) => emitted.push([n, p]), view });
  const iframe = root.children[0];
  unmount();
  view.fire('message', { source: iframe.contentWindow, data: { type: 'mod-event', name: 'win' } });
  assert.deepStrictEqual(emitted, []);
});
//// /mountMod ////

//// mountMod 沙箱:iframe 尚未就绪(contentWindow 为空)时拒绝消息,杜绝加载窗口期冒充 [@busybee 2026-06-14] ////
test('mountMod 沙箱档在 contentWindow 为空时不转任何消息', async () => {
  const { mountMod } = await loadMounter();
  const doc = makeFakeDoc();
  const root = doc.createElement('div');
  const view = makeFakeView();
  const emitted = [];
  mountMod(root, { frontendSpec: { kind: 'sandboxed', srcdoc: '' }, emits: ['win'] }, { emit: (n, p) => emitted.push([n, p]), view });
  const iframe = root.children[0];
  const ghost = iframe.contentWindow;
  iframe.contentWindow = null; // 模拟尚未就绪
  view.fire('message', { source: ghost, data: { type: 'mod-event', name: 'win' } });
  assert.deepStrictEqual(emitted, []);
});
