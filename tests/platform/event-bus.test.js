// audience: internal
// # event-bus.test
// 验证 EventBus 的行为契约:按类型分发、取消订阅、死窗口由总线侧统一过滤。

const { test } = require('node:test');
const assert = require('node:assert');
const { EventBus } = require('../../src/platform/bus/event-bus');

//// 同类型多订阅者都收到事件 [@busybee 2026-06-13] ////
test('publish fans out to all subscribers of the type', () => {
  const bus = new EventBus();
  const seen = [];
  bus.subscribe('EmotionChanged', (e) => seen.push(['a', e.value]));
  bus.subscribe('EmotionChanged', (e) => seen.push(['b', e.value]));

  bus.publish({ type: 'EmotionChanged', value: 'happy' });

  assert.deepStrictEqual(seen, [['a', 'happy'], ['b', 'happy']]);
});

//// 不同类型的订阅者互不感知 [@busybee 2026-06-13] ////
test('publish only reaches subscribers of the matching type', () => {
  const bus = new EventBus();
  let emotionHits = 0;
  let utteranceHits = 0;
  bus.subscribe('EmotionChanged', () => { emotionHits += 1; });
  bus.subscribe('UtteranceProduced', () => { utteranceHits += 1; });

  bus.publish({ type: 'EmotionChanged', value: 'sad' });

  assert.strictEqual(emotionHits, 1);
  assert.strictEqual(utteranceHits, 0);
});

//// 无订阅者时发布不抛错 [@busybee 2026-06-13] ////
test('publish with no subscribers is a no-op', () => {
  const bus = new EventBus();
  assert.doesNotThrow(() => bus.publish({ type: 'PerceptionUpdated' }));
});

//// 取消订阅后不再收到事件 [@busybee 2026-06-13] ////
test('unsubscribe stops further delivery', () => {
  const bus = new EventBus();
  let hits = 0;
  const off = bus.subscribe('ModEvent', () => { hits += 1; });

  bus.publish({ type: 'ModEvent' });
  off();
  bus.publish({ type: 'ModEvent' });

  assert.strictEqual(hits, 1);
});

//// 死窗口订阅者被总线侧跳过并不收到事件 [@busybee 2026-06-13] ////
test('dead subscriber is filtered out by the bus', () => {
  const bus = new EventBus();
  // 模拟一个窗口适配:isDestroyed 翻转后总线应停止转发,发布方无需知情。
  const fakeWindow = {
    destroyed: false,
    sent: [],
    isDestroyed() { return this.destroyed; },
    webContents: { send(event) { fakeWindow.sent.push(event); } },
  };
  bus.subscribe(
    'EmotionChanged',
    (e) => fakeWindow.webContents.send(e),
    () => !fakeWindow.isDestroyed(),
  );

  bus.publish({ type: 'EmotionChanged', value: 'angry' });
  fakeWindow.destroyed = true;
  bus.publish({ type: 'EmotionChanged', value: 'calm' });

  assert.deepStrictEqual(fakeWindow.sent.map((e) => e.value), ['angry']);
});

//// 死订阅者在分发时被剔除而非常驻 [@busybee 2026-06-13] ////
test('dead subscriber is pruned and never revives', () => {
  const bus = new EventBus();
  let alive = true;
  let hits = 0;
  bus.subscribe('PerceptionUpdated', () => { hits += 1; }, () => alive);

  alive = false;
  bus.publish({ type: 'PerceptionUpdated' });
  // 即使存活判断再次变真,已剔除的记录不应复活。
  alive = true;
  bus.publish({ type: 'PerceptionUpdated' });

  assert.strictEqual(hits, 0);
});

//// 缺省订阅者始终存活并持续收到事件 [@busybee 2026-06-13] ////
test('subscriber without liveness predicate stays alive', () => {
  const bus = new EventBus();
  let hits = 0;
  bus.subscribe('UtteranceProduced', () => { hits += 1; });

  bus.publish({ type: 'UtteranceProduced' });
  bus.publish({ type: 'UtteranceProduced' });

  assert.strictEqual(hits, 2);
});

//// 处理器内取消订阅不打断当次分发 [@busybee 2026-06-13] ////
test('unsubscribing during dispatch does not skip remaining subscribers', () => {
  const bus = new EventBus();
  const order = [];
  const off = bus.subscribe('ModEvent', () => { order.push('first'); off(); });
  bus.subscribe('ModEvent', () => { order.push('second'); });

  bus.publish({ type: 'ModEvent' });

  assert.deepStrictEqual(order, ['first', 'second']);
});
