// audience: internal
// # utterance.test
// 验证 Utterance 的数据契约:纯数据无副作用;气泡时长按音频时长加余量并守最短时长,无音频走默认时长。

const { test } = require('node:test');
const assert = require('node:assert');
const {
  Utterance,
  AUDIO_BUBBLE_BUFFER_MS,
  DEFAULT_BUBBLE_MS,
  MIN_BUBBLE_MS,
} = require('../../src/domain/speech/utterance');

//// 新建发言是各字段为空的纯数据 [@x380kkm 2026-06-13] ////
test('a fresh Utterance is empty pure data', () => {
  const utterance = new Utterance();
  assert.strictEqual(utterance.text, '');
  assert.strictEqual(utterance.emotion, null);
  assert.strictEqual(utterance.audioAlignment, null);
});

//// of 用文本与情绪构造尚无音频的发言 [@x380kkm 2026-06-13] ////
test('Utterance.of carries text and emotion without audio', () => {
  const utterance = Utterance.of('こんにちは', 'happy');
  assert.strictEqual(utterance.text, 'こんにちは');
  assert.strictEqual(utterance.emotion, 'happy');
  assert.strictEqual(utterance.audioAlignment, null);
  assert.strictEqual(utterance.hasAudio(), false);
});

//// 无音频时气泡走默认时长 [@x380kkm 2026-06-13] ////
test('bubbleDurationMs falls back to the default when there is no audio', () => {
  const utterance = Utterance.of('text');
  assert.strictEqual(utterance.bubbleDurationMs(), DEFAULT_BUBBLE_MS);
});

//// alignTo 用音频时长加余量算气泡时长 [@x380kkm 2026-06-13] ////
test('alignTo derives bubble duration as audio duration plus buffer', () => {
  const alignment = Utterance.alignTo('wav', 5000);
  assert.strictEqual(alignment.audio, 'wav');
  assert.strictEqual(alignment.durationMs, 5000);
  assert.strictEqual(alignment.bubbleDurationMs, 5000 + AUDIO_BUBBLE_BUFFER_MS);
});

//// 音频很短时气泡仍不短于最短时长 [@x380kkm 2026-06-13] ////
test('alignTo keeps the bubble at least the minimum for short audio', () => {
  const alignment = Utterance.alignTo('wav', 100);
  assert.strictEqual(alignment.bubbleDurationMs, MIN_BUBBLE_MS);
});

//// 对齐后发言报告有音频且气泡用对齐时长 [@x380kkm 2026-06-13] ////
test('an aligned Utterance reports audio and uses the aligned bubble duration', () => {
  const utterance = Utterance.of('text');
  utterance.audioAlignment = Utterance.alignTo('wav', 4000);
  assert.strictEqual(utterance.hasAudio(), true);
  assert.strictEqual(utterance.bubbleDurationMs(), 4000 + AUDIO_BUBBLE_BUFFER_MS);
});

//// 时长为零的对齐不算有音频,气泡退回默认 [@x380kkm 2026-06-13] ////
test('a zero-duration alignment does not count as audio', () => {
  const utterance = Utterance.of('text');
  utterance.audioAlignment = { audio: null, durationMs: 0, bubbleDurationMs: 0 };
  assert.strictEqual(utterance.hasAudio(), false);
  assert.strictEqual(utterance.bubbleDurationMs(), DEFAULT_BUBBLE_MS);
});
