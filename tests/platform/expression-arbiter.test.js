// audience: internal
// # expression-arbiter.test
// 验证表达区仲裁:换主导时收起被替下者、释放后回到无人占用、重复占主导不重复收起。
// 收起钩子用记录调用的假函数,不触真实窗口。

const { test } = require('node:test');
const assert = require('node:assert');
const { createExpressionArbiter } = require('../../src/platform/window/expression-arbiter.js');

function makeArbiter() {
  const hidden = [];
  const arbiter = createExpressionArbiter({
    hide: { bubble: () => hidden.push('bubble'), mod: () => hidden.push('mod') }
  });
  return { arbiter, hidden };
}

//// takeOver 换主导时收起先前主导者 [@x380kkm 2026-06-14] ////
test('takeOver 从 mod 切到 bubble 时收起 mod,反之亦然', () => {
  const { arbiter, hidden } = makeArbiter();
  assert.strictEqual(arbiter.takeOver('mod'), null);     // 原无主导,无人被替下
  assert.strictEqual(arbiter.current(), 'mod');
  assert.strictEqual(arbiter.takeOver('bubble'), 'mod'); // bubble 占主导,mod 被替下
  assert.deepStrictEqual(hidden, ['mod']);
  assert.strictEqual(arbiter.current(), 'bubble');
  assert.strictEqual(arbiter.takeOver('mod'), 'bubble');
  assert.deepStrictEqual(hidden, ['mod', 'bubble']);
});

test('takeOver 重复占主导不再收起、不返回被替下者', () => {
  const { arbiter, hidden } = makeArbiter();
  arbiter.takeOver('bubble');
  assert.strictEqual(arbiter.takeOver('bubble'), null);
  assert.deepStrictEqual(hidden, []);
});

test('release 仅当该占用者正占主导时回到无人占用', () => {
  const { arbiter } = makeArbiter();
  arbiter.takeOver('bubble');
  arbiter.release('mod');                 // 不是当前主导,无效
  assert.strictEqual(arbiter.current(), 'bubble');
  arbiter.release('bubble');
  assert.strictEqual(arbiter.current(), null);
  // 释放后再占主导,前一个已无主导故不触发收起
  const fresh = makeArbiter();
  fresh.arbiter.takeOver('mod');
  fresh.arbiter.release('mod');
  assert.strictEqual(fresh.arbiter.takeOver('bubble'), null);
  assert.deepStrictEqual(fresh.hidden, []);
});
//// /takeOver 换主导时收起先前主导者 ////
