// audience: internal
// # scheduler.test
// 验证 PetScheduler 主循环契约:按可配间隔驱动一轮采感知到跑意图、间隔下限 10 秒、按需喂情绪、start/stop 干净、单拍失败不拖垮周期。
// 运行: node --test tests/domain/scheduler.test.js

const { test } = require('node:test');
const assert = require('node:assert');
const { PetScheduler, MIN_INTERVAL_MS } = require('../../src/domain/pet/scheduler');

//// 注入计时替身:记下回调与间隔,fire() 手动驱动一拍,可断言已清理 [@busybee 2026-06-13] ////
function fakeTimer() {
  const state = { callback: null, intervalMs: null, cleared: false, handle: 'h1' };
  return {
    state,
    setInterval(callback, intervalMs) {
      state.callback = callback;
      state.intervalMs = intervalMs;
      state.cleared = false;
      return state.handle;
    },
    clearInterval(handle) {
      if (handle === state.handle) {
        state.cleared = true;
      }
    },
    //// 手动驱动一拍并等其异步跑完 [@busybee 2026-06-13] ////
    async fire() {
      await state.callback();
    }
  };
}

//// 注入感知替身:capture 回预置帧序列,逐拍取下一帧 [@busybee 2026-06-13] ////
function fakePerception(frames) {
  let i = 0;
  return { async capture() { return i < frames.length ? frames[i++] : null; } };
}

//// 注入采集替身:记录收到的帧与背景,回预置态势序列 [@busybee 2026-06-13] ////
function fakeCollector(situations) {
  let i = 0;
  const calls = [];
  return {
    calls,
    async tick(frame, background) {
      calls.push({ frame, background });
      return i < situations.length ? situations[i++] : null;
    }
  };
}

//// 注入意图注册表替身:记录 candidates 收到的作用域,回预置候选 [@busybee 2026-06-13] ////
function fakeRegistry(candidates) {
  const calls = [];
  return {
    calls,
    candidates(scope) { calls.push(scope); return candidates; }
  };
}

//// 注入决策器替身:据候选定首个意图,记录入参,回预置回应 [@busybee 2026-06-14] ////
function fakeDecider(response) {
  const calls = [];
  return {
    calls,
    async decide(candidates, scope) {
      calls.push({ candidates, scope });
      const intent = candidates && candidates.length ? candidates[0] : null;
      return { intent, response: intent ? response : null };
    }
  };
}

//// 注入情绪状态替身:记录每次喂入,normalized 回预置归一值 [@busybee 2026-06-14] ////
function fakeEmotionState(level) {
  const fed = [];
  return { fed, feed(input) { fed.push(input); }, normalized() { return level || 0; } };
}

const FRAME = { image: 'img', title: 'editor', background: 'bg' };
const INTENT = { id: 'observe' };
const REPLY = { text: '你在写代码呀', emotion: 'happy', modEvents: [] };

//// 间隔下限到 10 秒:过小或非数一律取 MIN_INTERVAL_MS [@busybee 2026-06-13] ////
test('clamps interval and chatGap to the 10s minimum', () => {
  const timer = fakeTimer();
  const tooSmall = new PetScheduler({ timer }, { intervalMs: 3000, chatGapMs: 500 });
  assert.strictEqual(tooSmall.intervalMs, MIN_INTERVAL_MS);
  assert.strictEqual(tooSmall.chatGapMs, MIN_INTERVAL_MS);

  const missing = new PetScheduler({ timer }, {});
  assert.strictEqual(missing.intervalMs, MIN_INTERVAL_MS);

  const ample = new PetScheduler({ timer }, { intervalMs: 30000, chatGapMs: 20000 });
  assert.strictEqual(ample.intervalMs, 30000);
  assert.strictEqual(ample.chatGapMs, 20000);
});

//// start 按 intervalMs 装定时器,stop 干净清除,重复调用各无副作用 [@busybee 2026-06-13] ////
test('start arms the timer at intervalMs and stop clears it cleanly', () => {
  const timer = fakeTimer();
  const scheduler = new PetScheduler({ timer }, { intervalMs: 15000 });

  scheduler.start();
  assert.strictEqual(timer.state.intervalMs, 15000);
  assert.strictEqual(typeof timer.state.callback, 'function');

  // 重复 start 不重复装定时器
  const firstCallback = timer.state.callback;
  scheduler.start();
  assert.strictEqual(timer.state.callback, firstCallback);

  scheduler.stop();
  assert.strictEqual(timer.state.cleared, true);

  // 重复 stop 无副作用
  timer.state.cleared = false;
  scheduler.stop();
  assert.strictEqual(timer.state.cleared, false);
});

//// 一拍跑通:采感知、组态势作用域、取候选、交决策器定动作产回应 [@busybee 2026-06-14] ////
test('one tick drives perceive then candidates then decide', async () => {
  const timer = fakeTimer();
  const collector = fakeCollector(['在写代码']);
  const registry = fakeRegistry([INTENT]);
  const decider = fakeDecider(REPLY);
  const scheduler = new PetScheduler({
    perception: fakePerception([FRAME]),
    collector,
    registry,
    decider,
    emotionState: fakeEmotionState(0.4),
    timer
  }, { intervalMs: 15000 });

  scheduler.start();
  await timer.fire();

  // 帧与背景透传给采集源
  assert.deepStrictEqual(collector.calls[0], { frame: FRAME, background: 'bg' });
  // 有态势即标记有视觉输入,态势作摘要,带归一情绪值
  const scope = registry.calls[0];
  assert.strictEqual(scope.signals.hasVisualInput, true);
  assert.strictEqual(scope.situationDigest, '在写代码');
  assert.strictEqual(scope.emotion, 0.4);
  // 决策器拿到候选与同一作用域
  assert.strictEqual(decider.calls[0].candidates[0], INTENT);
  assert.strictEqual(decider.calls[0].scope, scope);
});

//// 无态势时作用域落空闲:无视觉输入、摘要为空 [@busybee 2026-06-13] ////
test('without a situation the scope falls back to idle', async () => {
  const timer = fakeTimer();
  const registry = fakeRegistry([INTENT]);
  const scheduler = new PetScheduler({
    perception: fakePerception([FRAME]),
    collector: fakeCollector([]),
    registry,
    decider: fakeDecider(REPLY),
    timer
  }, {});

  scheduler.start();
  await timer.fire();

  const scope = registry.calls[0];
  assert.strictEqual(scope.signals.hasVisualInput, false);
  assert.strictEqual(scope.situationDigest, '');
  // 无情绪状态时归一情绪值落 0
  assert.strictEqual(scope.emotion, 0);
});

//// 无候选意图时不产回应:决策器回空意图,只喂 tick 不喂 reply [@busybee 2026-06-14] ////
test('no candidate means no response is produced', async () => {
  const timer = fakeTimer();
  const emotionState = fakeEmotionState();
  const scheduler = new PetScheduler({
    perception: fakePerception([FRAME]),
    collector: fakeCollector(['在写代码']),
    registry: fakeRegistry([]),
    decider: fakeDecider(REPLY),
    emotionState,
    timer
  }, {});

  scheduler.start();
  await timer.fire();

  assert.deepStrictEqual(emotionState.fed, [{ kind: 'tick' }]);
});

//// 每拍喂情绪 tick;跑出回应再按文本长度喂一次 reply 加成 [@busybee 2026-06-13] ////
test('feeds emotion a tick each cycle and a reply bonus on a produced response', async () => {
  const timer = fakeTimer();
  const emotionState = fakeEmotionState();
  const scheduler = new PetScheduler({
    perception: fakePerception([FRAME]),
    collector: fakeCollector(['在写代码']),
    registry: fakeRegistry([INTENT]),
    decider: fakeDecider(REPLY),
    emotionState,
    timer
  }, { intervalMs: 15000, chatGapMs: 10000 });

  scheduler.start();
  await timer.fire();

  assert.deepStrictEqual(emotionState.fed, [
    { kind: 'tick' },
    { kind: 'reply', length: REPLY.text.length }
  ]);
});

//// 无回应或空文本时只喂 tick 不喂 reply [@busybee 2026-06-13] ////
test('feeds only a tick when no reply text is produced', async () => {
  const timer = fakeTimer();
  const emotionState = fakeEmotionState();
  const scheduler = new PetScheduler({
    perception: fakePerception([FRAME]),
    collector: fakeCollector(['在写代码']),
    registry: fakeRegistry([INTENT]),
    decider: fakeDecider({ text: '' }),
    emotionState,
    timer
  }, {});

  scheduler.start();
  await timer.fire();

  assert.deepStrictEqual(emotionState.fed, [{ kind: 'tick' }]);
});

//// 守 chatGap:距上次产出不足间隔时不再喂 reply 加成 [@busybee 2026-06-13] ////
test('reply bonus is withheld within the chatGap window', async () => {
  const timer = fakeTimer();
  const emotionState = fakeEmotionState();
  let nowMs = 100000;
  const clock = { now: () => nowMs };
  const scheduler = new PetScheduler({
    perception: fakePerception([FRAME, FRAME]),
    collector: fakeCollector(['在写代码', '还在写代码']),
    registry: fakeRegistry([INTENT]),
    decider: fakeDecider(REPLY),
    emotionState,
    clock,
    timer
  }, { intervalMs: 15000, chatGapMs: 20000 });

  scheduler.start();
  await timer.fire();
  // 第二拍距首次产出仅 5 秒,未到 chatGap 的 20 秒
  nowMs += 5000;
  await timer.fire();

  const replyFeeds = emotionState.fed.filter((f) => f.kind === 'reply');
  assert.strictEqual(replyFeeds.length, 1);

  // 越过 chatGap 后再产出又可喂加成
  nowMs += 20000;
  await timer.fire();
  const replyFeedsAfter = emotionState.fed.filter((f) => f.kind === 'reply');
  assert.strictEqual(replyFeedsAfter.length, 2);
});

//// 单拍失败不抛回计时器,下一拍照常进行 [@busybee 2026-06-14] ////
test('a failing tick does not break the loop', async () => {
  const timer = fakeTimer();
  const registry = fakeRegistry([INTENT]);
  let firstCall = true;
  const flakyDecider = {
    calls: [],
    async decide(candidates, scope) {
      if (firstCall) {
        firstCall = false;
        throw new Error('boom');
      }
      this.calls.push({ candidates, scope });
      return { intent: candidates[0], response: REPLY };
    }
  };
  const scheduler = new PetScheduler({
    perception: fakePerception([FRAME, FRAME]),
    collector: fakeCollector(['在写代码', '还在写代码']),
    registry,
    decider: flakyDecider,
    timer
  }, {});

  scheduler.start();
  await timer.fire();
  await timer.fire();

  assert.strictEqual(flakyDecider.calls.length, 1);
});

//// 无感知源时作用域落空闲,仍照常取候选交决策 [@busybee 2026-06-14] ////
test('without a perception source the tick still drives a decision on idle scope', async () => {
  const timer = fakeTimer();
  const registry = fakeRegistry([INTENT]);
  const decider = fakeDecider(REPLY);
  const scheduler = new PetScheduler({ registry, decider, timer }, {});

  scheduler.start();
  await timer.fire();

  assert.strictEqual(registry.calls[0].signals.hasVisualInput, false);
  assert.strictEqual(decider.calls.length, 1);
});
