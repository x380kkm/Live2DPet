// 运行方式:node --test tests/platform/circuit-breaker.test.js
const { test } = require('node:test');
const assert = require('node:assert');
const { CircuitBreaker } = require('../../src/platform/speech/circuit-breaker');

//// 闭合态下成功调用透传返回值并清零失败计数 [@x380kkm 2026-06-13] ////
test('成功调用返回结果且不断开', () => {
  const breaker = new CircuitBreaker({ maxFailures: 3 });
  const result = breaker.execute(() => 'ok');
  assert.strictEqual(result, 'ok');
  assert.strictEqual(breaker.isOpen(), false);
});

//// 连续失败达到上限后切断开态 [@x380kkm 2026-06-13] ////
test('连续失败到上限后断开', () => {
  const breaker = new CircuitBreaker({ maxFailures: 3, fallback: null });
  const fail = () => { throw new Error('boom'); };
  for (let i = 0; i < 3; i++) breaker.execute(fail);
  assert.strictEqual(breaker.isOpen(), true);
});

//// 失败但未达上限时仍保持闭合态 [@x380kkm 2026-06-13] ////
test('未达上限不断开', () => {
  const breaker = new CircuitBreaker({ maxFailures: 3 });
  const fail = () => { throw new Error('boom'); };
  breaker.execute(fail);
  breaker.execute(fail);
  assert.strictEqual(breaker.isOpen(), false);
});

//// 失败后又成功会把失败计数清零,避免跨越式断开 [@x380kkm 2026-06-13] ////
test('中途成功清零失败计数', () => {
  const breaker = new CircuitBreaker({ maxFailures: 3 });
  const fail = () => { throw new Error('boom'); };
  breaker.execute(fail);
  breaker.execute(fail);
  breaker.execute(() => 'ok');
  breaker.execute(fail);
  breaker.execute(fail);
  assert.strictEqual(breaker.isOpen(), false);
});

//// 断开态且未到重试时刻时直接返回降级值,不调用 operation [@x380kkm 2026-06-13] ////
test('断开态走降级且不执行操作', () => {
  let clock = 1000;
  const breaker = new CircuitBreaker({ maxFailures: 1, retryInterval: 60000, fallback: 'degraded', now: () => clock });
  breaker.execute(() => { throw new Error('boom'); });
  assert.strictEqual(breaker.isOpen(), true);

  let called = false;
  const result = breaker.execute(() => { called = true; return 'real'; });
  assert.strictEqual(result, 'degraded');
  assert.strictEqual(called, false);
});

//// 断开后过了重试间隔则尝试恢复,放行下一次调用 [@x380kkm 2026-06-13] ////
test('过重试间隔后尝试恢复', () => {
  let clock = 1000;
  const breaker = new CircuitBreaker({ maxFailures: 1, retryInterval: 60000, now: () => clock });
  breaker.execute(() => { throw new Error('boom'); });
  assert.strictEqual(breaker.isOpen(), true);

  clock += 60000;
  const result = breaker.execute(() => 'recovered');
  assert.strictEqual(result, 'recovered');
  assert.strictEqual(breaker.isOpen(), false);
});

//// 切断开与恢复时触发注入的通知回调 [@x380kkm 2026-06-13] ////
test('断开与恢复触发回调', () => {
  let clock = 0;
  let tripped = 0;
  let reset = 0;
  const breaker = new CircuitBreaker({
    maxFailures: 1, retryInterval: 100, now: () => clock,
    onTrip: () => { tripped++; }, onReset: () => { reset++; },
  });
  breaker.execute(() => { throw new Error('boom'); });
  assert.strictEqual(tripped, 1);

  clock += 100;
  breaker.execute(() => 'ok');
  assert.strictEqual(reset, 1);
});
