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

//// 注入编排器替身:选意图取首个,跑意图记录入参回预置回应 [@busybee 2026-06-13] ////
function fakePet(response) {
  const calls = { select: [], run: [] };
  return {
    calls,
    async selectIntent(candidates, scope) {
      calls.select.push({ candidates, scope });
      return candidates && candidates.length ? candidates[0] : null;
    },
    async run(intent, scope) {
      calls.run.push({ intent, scope });
      return response;
    }
  };
}

//// 注入情绪状态替身:记录每次喂入 [@busybee 2026-06-13] ////
function fakeEmotionState() {
  const fed = [];
  return { fed, feed(input) { fed.push(input); } };
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

//// 一拍跑通:采感知、组态势作用域、取候选、选意图、跑意图 [@busybee 2026-06-13] ////
test('one tick drives perceive then candidates then select then run', async () => {
  const timer = fakeTimer();
  const collector = fakeCollector(['在写代码']);
  const registry = fakeRegistry([INTENT]);
  const pet = fakePet(REPLY);
  const scheduler = new PetScheduler({
    perception: fakePerception([FRAME]),
    collector,
    registry,
    pet,
    timer
  }, { intervalMs: 15000 });

  scheduler.start();
  await timer.fire();

  // 帧与背景透传给采集源
  assert.deepStrictEqual(collector.calls[0], { frame: FRAME, background: 'bg' });
  // 有态势即标记有视觉输入,态势作摘要
  const scope = registry.calls[0];
  assert.strictEqual(scope.signals.hasVisualInput, true);
  assert.strictEqual(scope.situationDigest, '在写代码');
  // 选意图拿到候选,跑意图拿到选出的意图
  assert.strictEqual(pet.calls.select[0].candidates[0], INTENT);
  assert.strictEqual(pet.calls.run[0].intent, INTENT);
});

//// 无态势时作用域落空闲:无视觉输入、摘要为空 [@busybee 2026-06-13] ////
test('without a situation the scope falls back to idle', async () => {
  const timer = fakeTimer();
  const registry = fakeRegistry([INTENT]);
  const scheduler = new PetScheduler({
    perception: fakePerception([FRAME]),
    collector: fakeCollector([]),
    registry,
    pet: fakePet(REPLY),
    timer
  }, {});

  scheduler.start();
  await timer.fire();

  const scope = registry.calls[0];
  assert.strictEqual(scope.signals.hasVisualInput, false);
  assert.strictEqual(scope.situationDigest, '');
});

//// 无候选意图时不跑意图 [@busybee 2026-06-13] ////
test('no candidate means run is skipped', async () => {
  const timer = fakeTimer();
  const pet = fakePet(REPLY);
  const scheduler = new PetScheduler({
    perception: fakePerception([FRAME]),
    collector: fakeCollector(['在写代码']),
    registry: fakeRegistry([]),
    pet,
    timer
  }, {});

  scheduler.start();
  await timer.fire();

  assert.strictEqual(pet.calls.run.length, 0);
});

//// 每拍喂情绪 tick;跑出回应再按文本长度喂一次 reply 加成 [@busybee 2026-06-13] ////
test('feeds emotion a tick each cycle and a reply bonus on a produced response', async () => {
  const timer = fakeTimer();
  const emotionState = fakeEmotionState();
  const scheduler = new PetScheduler({
    perception: fakePerception([FRAME]),
    collector: fakeCollector(['在写代码']),
    registry: fakeRegistry([INTENT]),
    pet: fakePet(REPLY),
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
    pet: fakePet({ text: '' }),
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
    pet: fakePet(REPLY),
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

//// 单拍失败不抛回计时器,下一拍照常进行 [@busybee 2026-06-13] ////
test('a failing tick does not break the loop', async () => {
  const timer = fakeTimer();
  const registry = fakeRegistry([INTENT]);
  let firstCall = true;
  const flakyPet = {
    calls: { run: [] },
    async selectIntent(candidates) { return candidates[0]; },
    async run() {
      if (firstCall) {
        firstCall = false;
        throw new Error('boom');
      }
      this.calls.run.push(REPLY);
      return REPLY;
    }
  };
  const scheduler = new PetScheduler({
    perception: fakePerception([FRAME, FRAME]),
    collector: fakeCollector(['在写代码', '还在写代码']),
    registry,
    pet: flakyPet,
    timer
  }, {});

  scheduler.start();
  await timer.fire();
  await timer.fire();

  assert.strictEqual(flakyPet.calls.run.length, 1);
});

//// 无感知源时作用域落空闲,仍照常取候选选跑 [@busybee 2026-06-13] ////
test('without a perception source the tick still drives selection on idle scope', async () => {
  const timer = fakeTimer();
  const registry = fakeRegistry([INTENT]);
  const pet = fakePet(REPLY);
  const scheduler = new PetScheduler({ registry, pet, timer }, {});

  scheduler.start();
  await timer.fire();

  assert.strictEqual(registry.calls[0].signals.hasVisualInput, false);
  assert.strictEqual(pet.calls.run.length, 1);
});
