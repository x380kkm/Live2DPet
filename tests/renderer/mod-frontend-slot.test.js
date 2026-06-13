// 断言 mod-frontend-slot 经沙箱宿主嵌入与切换:用假宿主与假元素,验证插入、切换、清空。
const { test } = require('node:test');
const assert = require('node:assert');

// 造一个假沙箱宿主:host 返回带 element 与 dispose 的受限框架,记录调用
function makeSandboxHost() {
  const hosted = [];
  const disposed = [];
  return {
    hosted,
    disposed,
    host(spec) {
      const frame = {
        spec,
        element: makeElement(),
        dispose() { disposed.push(spec.id); },
      };
      hosted.push(spec.id);
      return frame;
    },
  };
}

// 造一个最小的假元素,支持 appendChild、removeChild、classList、parentNode
function makeElement() {
  const el = {
    children: [],
    classList: makeClassList(),
    parentNode: null,
    appendChild(child) { this.children.push(child); child.parentNode = this; },
    removeChild(child) {
      this.children = this.children.filter((c) => c !== child);
      child.parentNode = null;
    },
  };
  return el;
}

function makeClassList() {
  const set = new Set();
  return {
    set,
    add: (c) => set.add(c),
    remove: (c) => set.delete(c),
    contains: (c) => set.has(c),
  };
}

test('embed 经沙箱宿主取框架并挂入槽,标记激活', async () => {
  const { ModFrontendSlot } = await import('../../src/renderer/stage/mod-frontend-slot.js');
  const host = makeSandboxHost();
  const slotEl = makeElement();
  const slot = new ModFrontendSlot({ slotElement: slotEl, sandboxHost: host });
  const frame = slot.embed({ id: 'game' });
  assert.deepStrictEqual(host.hosted, ['game']);
  assert.strictEqual(slotEl.children.length, 1);
  assert.strictEqual(slotEl.children[0], frame.element);
  assert.ok(slotEl.classList.contains('slot-active'));
  assert.ok(slot.hasFrontend());
});

test('embed 在已有前端时先清旧再嵌新', async () => {
  const { ModFrontendSlot } = await import('../../src/renderer/stage/mod-frontend-slot.js');
  const host = makeSandboxHost();
  const slotEl = makeElement();
  const slot = new ModFrontendSlot({ slotElement: slotEl, sandboxHost: host });
  slot.embed({ id: 'a' });
  slot.embed({ id: 'b' });
  assert.deepStrictEqual(host.disposed, ['a']);
  assert.strictEqual(slotEl.children.length, 1);
});

test('switchTo 同 id 免动,不重复嵌入', async () => {
  const { ModFrontendSlot } = await import('../../src/renderer/stage/mod-frontend-slot.js');
  const host = makeSandboxHost();
  const slot = new ModFrontendSlot({ slotElement: makeElement(), sandboxHost: host });
  slot.embed({ id: 'a' });
  slot.switchTo({ id: 'a' });
  assert.deepStrictEqual(host.hosted, ['a']);
  assert.deepStrictEqual(host.disposed, []);
});

test('switchTo 不同 id 清旧嵌新', async () => {
  const { ModFrontendSlot } = await import('../../src/renderer/stage/mod-frontend-slot.js');
  const host = makeSandboxHost();
  const slot = new ModFrontendSlot({ slotElement: makeElement(), sandboxHost: host });
  slot.embed({ id: 'a' });
  slot.switchTo({ id: 'b' });
  assert.deepStrictEqual(host.hosted, ['a', 'b']);
  assert.deepStrictEqual(host.disposed, ['a']);
});

test('clear 销毁框架、摘除元素、标记不可见', async () => {
  const { ModFrontendSlot } = await import('../../src/renderer/stage/mod-frontend-slot.js');
  const host = makeSandboxHost();
  const slotEl = makeElement();
  const slot = new ModFrontendSlot({ slotElement: slotEl, sandboxHost: host });
  slot.embed({ id: 'a' });
  slot.clear();
  assert.deepStrictEqual(host.disposed, ['a']);
  assert.strictEqual(slotEl.children.length, 0);
  assert.strictEqual(slotEl.classList.contains('slot-active'), false);
  assert.strictEqual(slot.hasFrontend(), false);
});
