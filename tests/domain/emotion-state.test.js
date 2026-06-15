// audience: internal
// # emotion-state.test
// 验证 EmotionState 的行为契约:按输入推进、到阈值发事件并清零、悬停叠加、回复加成、不直接播放。

const { test } = require('node:test');
const assert = require('node:assert');
const { EmotionState, THRESHOLD_REACHED } = require('../../src/domain/emotion/emotion-state');

// 记录所有发布事件的总线替身,供断言对外输出。
function makeBus() {
  const events = [];
  return { events, publish(event) { events.push(event); } };
}

//// 一拍 tick 按基础量推进当前值 [@x380kkm 2026-06-13] ////
test('feed tick advances current by base rate', () => {
  const bus = makeBus();
  const state = new EmotionState(bus, { threshold: 100, baseRatePerTick: 2 });

  state.feed({ kind: 'tick' });

  assert.strictEqual(state.current, 2);
  assert.strictEqual(bus.events.length, 0);
});

//// 悬停时一拍在基础量上叠加悬停量 [@x380kkm 2026-06-13] ////
test('feed tick adds hover rate when hovering', () => {
  const bus = makeBus();
  const state = new EmotionState(bus, { threshold: 100, baseRatePerTick: 2, hoverRatePerTick: 3 });

  state.feed({ kind: 'tick', hovering: true });

  assert.strictEqual(state.current, 5);
});

//// 到阈值时发布到阈值事件并把当前值清零 [@x380kkm 2026-06-13] ////
test('reaching threshold publishes event and resets current', () => {
  const bus = makeBus();
  const state = new EmotionState(bus, { threshold: 10, baseRatePerTick: 10 });

  state.feed({ kind: 'tick' });

  assert.strictEqual(bus.events.length, 1);
  assert.strictEqual(bus.events[0].type, THRESHOLD_REACHED);
  assert.strictEqual(bus.events[0].value, 10);
  assert.strictEqual(state.current, 0);
});

//// 未到阈值时不发任何事件 [@x380kkm 2026-06-13] ////
test('below threshold publishes nothing', () => {
  const bus = makeBus();
  const state = new EmotionState(bus, { threshold: 100, baseRatePerTick: 5 });

  state.feed({ kind: 'tick' });
  state.feed({ kind: 'tick' });

  assert.strictEqual(bus.events.length, 0);
  assert.strictEqual(state.hasReachedThreshold(), false);
});

//// 回复加成按文本长度给一次性推进,随机源可注入 [@x380kkm 2026-06-13] ////
test('reply bonus scales with text length using injected random', () => {
  const bus = makeBus();
  // 注入恒定随机源,使加成确定:base + random * span * (length / cap)。
  const state = new EmotionState(
    bus,
    { threshold: 1000, replyBonusBase: 5, replyBonusSpan: 20, replyLengthCap: 100 },
    { random: () => 1 }
  );

  state.feed({ kind: 'reply', length: 50 });

  // 5 + 1 * 20 * (50 / 100) = 15
  assert.ok(Math.abs(state.current - 15) < 1e-9);
});

//// 回复加成把超长文本的长度因子封顶为一 [@x380kkm 2026-06-13] ////
test('reply bonus caps length factor at one', () => {
  const bus = makeBus();
  const state = new EmotionState(
    bus,
    { threshold: 1000, replyBonusBase: 5, replyBonusSpan: 20, replyLengthCap: 100 },
    { random: () => 1 }
  );

  state.feed({ kind: 'reply', length: 100000 });

  // 5 + 1 * 20 * 1 = 25,长度因子封顶为一。
  assert.ok(Math.abs(state.current - 25) < 1e-9);
});

//// 缺省输入或空输入不推进也不发事件 [@x380kkm 2026-06-13] ////
test('empty input is a no-op', () => {
  const bus = makeBus();
  const state = new EmotionState(bus, { threshold: 100, baseRatePerTick: 5 });

  state.feed(null);

  assert.strictEqual(state.current, 0);
  assert.strictEqual(bus.events.length, 0);
});

//// 越过阈值清零后可重新积累并再次到阈值 [@x380kkm 2026-06-13] ////
test('state re-accumulates after reset and fires again', () => {
  const bus = makeBus();
  const state = new EmotionState(bus, { threshold: 10, baseRatePerTick: 10 });

  state.feed({ kind: 'tick' });
  state.feed({ kind: 'tick' });

  assert.strictEqual(bus.events.length, 2);
  assert.strictEqual(state.current, 0);
});
