// audience: internal
// # perception-collector.test
// 验证 PerceptionCollector 连接件:每帧投入缓冲、驱动选帧、对最新关键帧抽态势、把非空态势写入记忆;空帧与空态势不写记忆。

const { test } = require('node:test');
const assert = require('node:assert');
const { PerceptionCollector } = require('../../src/domain/pet/perception-collector');

//// 记录 push 的关键帧缓冲替身 [@busybee 2026-06-13] ////
function fakeBuffer() {
  const pushed = [];
  return { pushed, async push(frame) { pushed.push(frame); } };
}

//// 记录调用、按预置回态势与关键帧的抽取器替身 [@busybee 2026-06-13] ////
function fakeExtractor({ situation = null, keyframes = [] } = {}) {
  const calls = { selectKeyframes: 0, extract: [] };
  return {
    calls,
    async selectKeyframes() { calls.selectKeyframes += 1; return keyframes; },
    async extract(frame, background) { calls.extract.push({ frame, background }); return situation; },
    keyframes() { return keyframes; }
  };
}

//// 记录 append 的记忆库替身 [@busybee 2026-06-13] ////
function fakeMemory() {
  const appended = [];
  return { appended, append(entry) { appended.push(entry); } };
}

const FRAME = { image: 'img', title: 'editor' };

//// 一拍跑通:投帧、选帧、抽态势,非空态势写入记忆并返回 [@busybee 2026-06-13] ////
test('tick pushes frame, selects keyframes, extracts and remembers situation', async () => {
  const buffer = fakeBuffer();
  const extractor = fakeExtractor({ situation: '在写代码' });
  const memory = fakeMemory();
  const collector = new PerceptionCollector({ buffer, extractor, memoryStore: memory });

  const situation = await collector.tick(FRAME, 'desktop bg');

  assert.strictEqual(situation, '在写代码');
  assert.deepStrictEqual(buffer.pushed, [FRAME]);
  assert.strictEqual(extractor.calls.selectKeyframes, 1);
  assert.deepStrictEqual(memory.appended, [{ situation: '在写代码', title: 'editor' }]);
});

//// 抽取器选出关键帧时,态势抽取以最新关键帧为目标而非原始帧 [@busybee 2026-06-13] ////
test('extraction targets the latest selected keyframe', async () => {
  const buffer = fakeBuffer();
  const keyframe = { image: 'kf', title: 'browser' };
  const extractor = fakeExtractor({ situation: '在看网页', keyframes: [keyframe] });
  const memory = fakeMemory();
  const collector = new PerceptionCollector({ buffer, extractor, memoryStore: memory });

  await collector.tick(FRAME, null);

  assert.strictEqual(extractor.calls.extract[0].frame, keyframe);
  assert.deepStrictEqual(memory.appended, [{ situation: '在看网页', title: 'browser' }]);
});

//// 无关键帧选出时退回对原始帧抽态势 [@busybee 2026-06-13] ////
test('with no selected keyframe extraction falls back to the incoming frame', async () => {
  const buffer = fakeBuffer();
  const extractor = fakeExtractor({ situation: '在写代码', keyframes: [] });
  const collector = new PerceptionCollector({ buffer, extractor, memoryStore: fakeMemory() });

  await collector.tick(FRAME, null);

  assert.strictEqual(extractor.calls.extract[0].frame, FRAME);
});

//// 态势为空时不写记忆并返回 null [@busybee 2026-06-13] ////
test('empty situation is not remembered', async () => {
  const buffer = fakeBuffer();
  const extractor = fakeExtractor({ situation: null });
  const memory = fakeMemory();
  const collector = new PerceptionCollector({ buffer, extractor, memoryStore: memory });

  const situation = await collector.tick(FRAME, null);

  assert.strictEqual(situation, null);
  assert.strictEqual(memory.appended.length, 0);
  // 投帧与选帧仍照常进行,只是这拍没抽出态势。
  assert.deepStrictEqual(buffer.pushed, [FRAME]);
  assert.strictEqual(extractor.calls.selectKeyframes, 1);
});

//// 空帧直接返回 null,不投帧不选帧不抽态势 [@busybee 2026-06-13] ////
test('empty frame returns null without touching the pipeline', async () => {
  const buffer = fakeBuffer();
  const extractor = fakeExtractor({ situation: '在写代码' });
  const memory = fakeMemory();
  const collector = new PerceptionCollector({ buffer, extractor, memoryStore: memory });

  assert.strictEqual(await collector.tick(null), null);
  assert.strictEqual(await collector.tick({ title: 'no image' }), null);
  assert.strictEqual(buffer.pushed.length, 0);
  assert.strictEqual(extractor.calls.selectKeyframes, 0);
  assert.strictEqual(memory.appended.length, 0);
});

//// 把抽态势的背景文本透传给抽取器 [@busybee 2026-06-13] ////
test('background text is passed through to the extractor', async () => {
  const extractor = fakeExtractor({ situation: '在写代码' });
  const collector = new PerceptionCollector({ buffer: fakeBuffer(), extractor, memoryStore: fakeMemory() });

  await collector.tick(FRAME, 'recent memory lines');

  assert.strictEqual(extractor.calls.extract[0].background, 'recent memory lines');
});
