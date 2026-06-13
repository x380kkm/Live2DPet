// audience: internal
// # utterance-session.test
// 验证发言会话:取消经显式令牌而非全局计数器;产物经事件总线发布而非直触窗口;新发言取消旧发言;合成中途被取消则不发布。

const { test } = require('node:test');
const assert = require('node:assert');
const { UtteranceSession, CancelToken } = require('../../src/domain/speech/utterance-session');
const { Utterance } = require('../../src/domain/speech/utterance');

//// 造一个记录发布事件的事件总线模拟 [@busybee 2026-06-13] ////
function makeBus() {
  const events = [];
  return { events, publish: (event) => events.push(event) };
}

//// 造一个把发言填上指定时长音频对齐的编排器模拟,可选合成期回调用于模拟竞态 [@busybee 2026-06-13] ////
function makeOrchestrator({ durationMs = 4000, onSynthesize = null } = {}) {
  const calls = { synthesized: [] };
  const orchestrator = {
    synthesize(utterance) {
      calls.synthesized.push(utterance);
      if (onSynthesize) onSynthesize(utterance);
      if (durationMs > 0) utterance.audioAlignment = Utterance.alignTo('wav', durationMs);
      return utterance;
    },
  };
  return { orchestrator, calls };
}

//// 取消令牌缺省存活,取消后转为不活跃 [@busybee 2026-06-13] ////
test('a CancelToken starts active and flips on cancel', () => {
  const token = new CancelToken();
  assert.strictEqual(token.isActive(), true);
  token.cancel();
  assert.strictEqual(token.isActive(), false);
});

//// 开始发言返回取消令牌并经总线发布产物 [@busybee 2026-06-13] ////
test('start returns a cancel token and publishes the produced utterance', () => {
  const bus = makeBus();
  const { orchestrator } = makeOrchestrator({ durationMs: 4000 });
  const session = new UtteranceSession({ eventBus: bus, ttsOrchestrator: orchestrator });

  const token = session.start({ text: 'こんにちは', emotion: 'happy' });

  assert.ok(token instanceof CancelToken);
  assert.strictEqual(bus.events.length, 1);
  const event = bus.events[0];
  assert.strictEqual(event.type, 'UtteranceProduced');
  assert.strictEqual(event.utterance.text, 'こんにちは');
  assert.strictEqual(event.utterance.emotion, 'happy');
  assert.strictEqual(event.hasAudio, true);
  assert.strictEqual(event.bubbleDurationMs, event.utterance.bubbleDurationMs());
});

//// 无音频对齐时仍发布产物,气泡走默认时长 [@busybee 2026-06-13] ////
test('start still publishes without audio, using the default bubble duration', () => {
  const bus = makeBus();
  const { orchestrator } = makeOrchestrator({ durationMs: 0 });
  const session = new UtteranceSession({ eventBus: bus, ttsOrchestrator: orchestrator });

  session.start({ text: 'text' });

  const event = bus.events[0];
  assert.strictEqual(event.hasAudio, false);
  assert.strictEqual(event.bubbleDurationMs, event.utterance.bubbleDurationMs());
});

//// 新发言开始时取消上一条发言的令牌 [@busybee 2026-06-13] ////
test('starting a new utterance cancels the previous token', () => {
  const bus = makeBus();
  const { orchestrator } = makeOrchestrator();
  const session = new UtteranceSession({ eventBus: bus, ttsOrchestrator: orchestrator });

  const first = session.start({ text: '一つ目' });
  const second = session.start({ text: '二つ目' });

  assert.strictEqual(first.isActive(), false);
  assert.strictEqual(second.isActive(), true);
});

//// 合成期间被新发言抢占的令牌不发布其产物 [@busybee 2026-06-13] ////
test('an utterance cancelled mid-synthesis does not publish its product', () => {
  const bus = makeBus();
  let session;
  // 合成回调里抢占式开始新发言,模拟旧令牌在合成中途被取消的竞态
  const { orchestrator } = makeOrchestrator({
    onSynthesize: (utterance) => {
      if (utterance.text === '古い' && session._preempted !== true) {
        session._preempted = true;
        session.start({ text: '新しい' });
      }
    },
  });
  session = new UtteranceSession({ eventBus: bus, ttsOrchestrator: orchestrator });

  session.start({ text: '古い' });

  const produced = bus.events.filter((e) => e.type === 'UtteranceProduced');
  // 只有抢占后的新发言被发布,被抢占的旧发言不发布
  assert.strictEqual(produced.length, 1);
  assert.strictEqual(produced[0].utterance.text, '新しい');
});

//// 取消当前发言会发布发言结束事件 [@busybee 2026-06-13] ////
test('cancelling the active utterance publishes an ended event', () => {
  const bus = makeBus();
  const { orchestrator } = makeOrchestrator();
  const session = new UtteranceSession({ eventBus: bus, ttsOrchestrator: orchestrator });

  const token = session.start({ text: 'text' });
  session.cancel(token);

  assert.strictEqual(token.isActive(), false);
  const ended = bus.events.filter((e) => e.type === 'UtteranceEnded');
  assert.strictEqual(ended.length, 1);
});

//// 取消一个非当前的旧令牌只翻转其状态,不发结束事件 [@busybee 2026-06-13] ////
test('cancelling a stale token only flips it without an ended event', () => {
  const bus = makeBus();
  const { orchestrator } = makeOrchestrator();
  const session = new UtteranceSession({ eventBus: bus, ttsOrchestrator: orchestrator });

  const stale = session.start({ text: '古い' });
  session.start({ text: '新しい' });
  const endedBefore = bus.events.filter((e) => e.type === 'UtteranceEnded').length;

  session.cancel(stale);

  const endedAfter = bus.events.filter((e) => e.type === 'UtteranceEnded').length;
  assert.strictEqual(endedAfter, endedBefore);
});

//// 缺事件总线时开始发言不抛错,仍返回令牌 [@busybee 2026-06-13] ////
test('start tolerates a missing event bus', () => {
  const { orchestrator } = makeOrchestrator();
  const session = new UtteranceSession({ ttsOrchestrator: orchestrator });
  assert.doesNotThrow(() => session.start({ text: 'text' }));
});
