// audience: internal
// # emotion-reaction.test
// 验证 EmotionReaction 连接件:订阅发言产物事件、两种载荷都取出 spokenText 喂选择器、空文本不触发、stop 后撤销订阅。

const { test } = require('node:test');
const assert = require('node:assert');
const { EventBus } = require('../../src/platform/bus/event-bus');
const { EmotionReaction, UTTERANCE_PRODUCED } = require('../../src/domain/pet/emotion-reaction');

//// 记录每次 select 收到状态的情绪选择器替身 [@x380kkm 2026-06-13] ////
function fakeSelector() {
  const selected = [];
  return {
    selected,
    async select(state) {
      selected.push(state);
      return 'happy';
    }
  };
}

//// pet 编排器载荷:{ text } 触发一次选取 [@x380kkm 2026-06-13] ////
test('orchestrator payload feeds spoken text to the selector', () => {
  const bus = new EventBus();
  const selector = fakeSelector();
  new EmotionReaction({ eventBus: bus, emotionSelector: selector }).start();

  bus.publish({ type: UTTERANCE_PRODUCED, text: '你好呀' });

  assert.deepStrictEqual(selector.selected, [{ spokenText: '你好呀' }]);
});

//// utterance-session 载荷:{ utterance:{ text } } 取出文本 [@x380kkm 2026-06-13] ////
test('utterance payload feeds the utterance text to the selector', () => {
  const bus = new EventBus();
  const selector = fakeSelector();
  new EmotionReaction({ eventBus: bus, emotionSelector: selector }).start();

  bus.publish({ type: UTTERANCE_PRODUCED, utterance: { text: '我在这里' } });

  assert.deepStrictEqual(selector.selected, [{ spokenText: '我在这里' }]);
});

//// 空文本的发言事件不触发选取 [@x380kkm 2026-06-13] ////
test('empty spoken text does not trigger selection', () => {
  const bus = new EventBus();
  const selector = fakeSelector();
  new EmotionReaction({ eventBus: bus, emotionSelector: selector }).start();

  bus.publish({ type: UTTERANCE_PRODUCED, text: '' });
  bus.publish({ type: UTTERANCE_PRODUCED, utterance: { text: '' } });

  assert.strictEqual(selector.selected.length, 0);
});

//// stop 后撤销订阅,后续事件不再触发选取 [@x380kkm 2026-06-13] ////
test('stop unsubscribes so later events do not trigger selection', () => {
  const bus = new EventBus();
  const selector = fakeSelector();
  const reaction = new EmotionReaction({ eventBus: bus, emotionSelector: selector });
  reaction.start();
  reaction.stop();

  bus.publish({ type: UTTERANCE_PRODUCED, text: '你好' });

  assert.strictEqual(selector.selected.length, 0);
});

//// 重复 start 不让一条事件触发多次选取 [@x380kkm 2026-06-13] ////
test('repeated start does not double-trigger on one event', () => {
  const bus = new EventBus();
  const selector = fakeSelector();
  const reaction = new EmotionReaction({ eventBus: bus, emotionSelector: selector });
  reaction.start();
  reaction.start();

  bus.publish({ type: UTTERANCE_PRODUCED, text: '一次' });

  assert.strictEqual(selector.selected.length, 1);
});

//// start 返回的取消订阅函数可独立撤销 [@x380kkm 2026-06-13] ////
test('start returns an unsubscribe function', () => {
  const bus = new EventBus();
  const selector = fakeSelector();
  const unsubscribe = new EmotionReaction({ eventBus: bus, emotionSelector: selector }).start();
  unsubscribe();

  bus.publish({ type: UTTERANCE_PRODUCED, text: '你好' });

  assert.strictEqual(selector.selected.length, 0);
});
