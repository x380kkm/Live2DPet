// 断言 chat-bubble 的尺寸预算与默认小按需展开:用假元素与假调窗能力,不触真实 DOM。
const { test } = require('node:test');
const assert = require('node:assert');

// 造一个假文本元素,getBoundingClientRect 返回给定内容尺寸
function makeText(rect) {
  return { textContent: '', getBoundingClientRect: () => rect };
}

// 造一个假气泡框元素,记录 display
function makeFrame() {
  return { style: { display: 'none' } };
}

// 记录每次请求的窗口尺寸
function makeResizeSpy() {
  const calls = [];
  const fn = (width, height) => calls.push({ width, height });
  return { calls, fn };
}

const BUDGET = {
  min: { width: 160, height: 60 },
  collapsedMax: { width: 300, height: 140 },
  expandedMax: { width: 420, height: 360 },
};

test('budgetSize 折叠态把超大内容钳到折叠上限', async () => {
  const { budgetSize } = await import('../../src/renderer/stage/chat-bubble.js');
  const sized = budgetSize({ width: 900, height: 900 }, BUDGET, false);
  assert.deepStrictEqual(sized, { width: 300, height: 140 });
});

test('budgetSize 展开态用更大的上限', async () => {
  const { budgetSize } = await import('../../src/renderer/stage/chat-bubble.js');
  const sized = budgetSize({ width: 900, height: 900 }, BUDGET, true);
  assert.deepStrictEqual(sized, { width: 420, height: 360 });
});

test('budgetSize 把过小内容抬到下限', async () => {
  const { budgetSize } = await import('../../src/renderer/stage/chat-bubble.js');
  const sized = budgetSize({ width: 10, height: 10 }, BUDGET, false);
  assert.deepStrictEqual(sized, { width: 160, height: 60 });
});

test('budgetSize 区间内的内容尺寸原样保留', async () => {
  const { budgetSize } = await import('../../src/renderer/stage/chat-bubble.js');
  const sized = budgetSize({ width: 220, height: 100 }, BUDGET, false);
  assert.deepStrictEqual(sized, { width: 220, height: 100 });
});

test('show 写入文本、显示框、默认折叠并按折叠预算调窗', async () => {
  const { ChatBubble } = await import('../../src/renderer/stage/chat-bubble.js');
  const frame = makeFrame();
  const text = makeText({ width: 1000, height: 1000 });
  const resize = makeResizeSpy();
  const bubble = new ChatBubble({ frameElement: frame, textElement: text, resizeWindow: resize.fn, budget: BUDGET });
  bubble.show('你好');
  assert.strictEqual(text.textContent, '你好');
  assert.strictEqual(frame.style.display, 'flex');
  assert.strictEqual(bubble.expanded, false);
  assert.deepStrictEqual(resize.calls.at(-1), { width: 300, height: 140 });
});

test('expand 切到展开上限并重新调窗', async () => {
  const { ChatBubble } = await import('../../src/renderer/stage/chat-bubble.js');
  const text = makeText({ width: 1000, height: 1000 });
  const resize = makeResizeSpy();
  const bubble = new ChatBubble({ frameElement: makeFrame(), textElement: text, resizeWindow: resize.fn, budget: BUDGET });
  bubble.show('长文本');
  bubble.expand();
  assert.strictEqual(bubble.expanded, true);
  assert.deepStrictEqual(resize.calls.at(-1), { width: 420, height: 360 });
});

test('collapse 从展开回到折叠上限', async () => {
  const { ChatBubble } = await import('../../src/renderer/stage/chat-bubble.js');
  const text = makeText({ width: 1000, height: 1000 });
  const resize = makeResizeSpy();
  const bubble = new ChatBubble({ frameElement: makeFrame(), textElement: text, resizeWindow: resize.fn, budget: BUDGET });
  bubble.show('文本');
  bubble.expand();
  bubble.collapse();
  assert.strictEqual(bubble.expanded, false);
  assert.deepStrictEqual(resize.calls.at(-1), { width: 300, height: 140 });
});

test('无文本元素时 measure 回退到预算下限', async () => {
  const { ChatBubble } = await import('../../src/renderer/stage/chat-bubble.js');
  const resize = makeResizeSpy();
  const bubble = new ChatBubble({ frameElement: makeFrame(), textElement: null, resizeWindow: resize.fn, budget: BUDGET });
  bubble.show('x');
  assert.deepStrictEqual(resize.calls.at(-1), { width: 160, height: 60 });
});
