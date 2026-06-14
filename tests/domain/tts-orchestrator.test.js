// audience: internal
// # tts-orchestrator.test
// 验证 TTS 编排:分句在句末标点后切、过短合并;逐句经注入的后端合成、拼接、按 WAV 头算时长回填发言;后端缺失或合成失败安全退化。

const { test } = require('node:test');
const assert = require('node:assert');
const {
  TtsOrchestrator,
  concatWavBuffers,
  wavDurationMs,
} = require('../../src/domain/tts/tts-orchestrator');
const { Utterance } = require('../../src/domain/speech/utterance');

// WAV 头长度与拼接函数里一致
const WAV_HEADER_BYTES = 44;

//// 造一个指定格式与 PCM 字节数的最小 WAV 缓冲,头字段足以算时长与拼接 [@busybee 2026-06-13] ////
function makeWav({ sampleRate = 24000, numChannels = 1, bitsPerSample = 16, pcmLen = 0 } = {}) {
  const blockAlign = numChannels * (bitsPerSample / 8);
  const byteRate = sampleRate * blockAlign;
  const buf = Buffer.alloc(WAV_HEADER_BYTES + pcmLen);
  buf.write('RIFF', 0);
  buf.writeUInt32LE(36 + pcmLen, 4);
  buf.write('WAVE', 8);
  buf.write('fmt ', 12);
  buf.writeUInt32LE(16, 16);
  buf.writeUInt16LE(1, 20);
  buf.writeUInt16LE(numChannels, 22);
  buf.writeUInt32LE(sampleRate, 24);
  buf.writeUInt32LE(byteRate, 28);
  buf.writeUInt16LE(blockAlign, 32);
  buf.writeUInt16LE(bitsPerSample, 34);
  buf.write('data', 36);
  buf.writeUInt32LE(pcmLen, 40);
  // 用可辨认的字节填 PCM,便于断言拼接后顺序
  buf.fill(0xab, WAV_HEADER_BYTES);
  return buf;
}

//// 造一个记录合成请求的后端模拟,按文本长度返回对应 PCM 字节数的 WAV [@busybee 2026-06-13] ////
function makeBackend(overrides = {}) {
  const calls = { synthesized: [] };
  const backend = {
    synthesize(text) {
      calls.synthesized.push(text);
      if (overrides.synthesize) return overrides.synthesize(text);
      // 每字符一个采样,便于按文本长度推时长
      return makeWav({ pcmLen: text.length * 2 });
    },
  };
  return { backend, calls };
}

//// 短文本不分句,原样作为单段 [@busybee 2026-06-13] ////
test('segment leaves short text as a single chunk', () => {
  const orch = new TtsOrchestrator({ speechBackend: null, maxChunkLen: 80 });
  assert.deepStrictEqual(orch.segment('短い文'), ['短い文']);
});

//// 超长文本在句末标点后切,过短的相邻段合并到上限内 [@busybee 2026-06-13] ////
test('segment splits at sentence punctuation and merges short pieces', () => {
  const orch = new TtsOrchestrator({ speechBackend: null, maxChunkLen: 6 });
  const chunks = orch.segment('あ。い。うえお。か');
  // 合并后每段长度不超过上限 6
  for (const chunk of chunks) assert.ok(chunk.length <= 6, `chunk too long: ${chunk}`);
  // 切片首尾相接还原原文,不丢字不重字
  assert.strictEqual(chunks.join(''), 'あ。い。うえお。か');
});

//// 连续句末标点与其后装饰符算作同一段不被拆开 [@busybee 2026-06-13] ////
test('segment keeps trailing decorative chars with their sentence', () => {
  const orch = new TtsOrchestrator({ speechBackend: null, maxChunkLen: 4 });
  const chunks = orch.segment('やった！！♡そうね');
  assert.ok(chunks[0].startsWith('やった！！♡'));
});

//// 单个 WAV 缓冲拼接原样返回 [@busybee 2026-06-13] ////
test('concatWavBuffers returns a single buffer unchanged', () => {
  const wav = makeWav({ pcmLen: 8 });
  assert.strictEqual(concatWavBuffers([wav]), wav);
});

//// 多个 WAV 拼接:PCM 相连、头里 data 长度为合计 [@busybee 2026-06-13] ////
test('concatWavBuffers merges PCM and rewrites the data length', () => {
  const a = makeWav({ pcmLen: 8 });
  const b = makeWav({ pcmLen: 12 });
  const out = concatWavBuffers([a, b]);
  assert.strictEqual(out.length, WAV_HEADER_BYTES + 20);
  assert.strictEqual(out.readUInt32LE(40), 20);
  assert.strictEqual(out.readUInt32LE(4), 36 + 20);
});

//// 给分隔 PCM 时插在各段之间,用于断句气音 [@busybee 2026-06-14] ////
test('concatWavBuffers inserts a separator PCM between chunks', () => {
  const a = makeWav({ pcmLen: 8 });
  const b = makeWav({ pcmLen: 12 });
  const separator = Buffer.alloc(6, 0xcd);
  const out = concatWavBuffers([a, b], separator);
  // 头 + a 的 8 + 分隔 6 + b 的 12 = 26 字节 PCM
  assert.strictEqual(out.readUInt32LE(40), 8 + 6 + 12);
  assert.strictEqual(out.length, WAV_HEADER_BYTES + 26);
  // 分隔出现在 a 之后:偏移 44+8 处为 0xcd
  assert.strictEqual(out[WAV_HEADER_BYTES + 8], 0xcd);
});

//// 按 WAV 头字节率把 PCM 字节数换算成毫秒 [@busybee 2026-06-13] ////
test('wavDurationMs derives milliseconds from byte rate and PCM length', () => {
  // 24000 采样率、单声道、16 位:字节率 48000;PCM 48000 字节恰好一秒
  const wav = makeWav({ sampleRate: 24000, pcmLen: 48000 });
  assert.strictEqual(wavDurationMs(wav), 1000);
});

//// 只有头没有 PCM 时时长为零 [@busybee 2026-06-13] ////
test('wavDurationMs is zero for a header-only buffer', () => {
  assert.strictEqual(wavDurationMs(makeWav({ pcmLen: 0 })), 0);
});

//// 合成把发言逐句送后端、拼接、算时长后回填音频对齐 [@busybee 2026-06-13] ////
test('synthesize fills the utterance audio alignment from synthesized chunks', () => {
  const { backend, calls } = makeBackend();
  const orch = new TtsOrchestrator({ speechBackend: backend, maxChunkLen: 4 });
  const utterance = Utterance.of('あ。い。う');
  orch.synthesize(utterance);

  assert.ok(calls.synthesized.length >= 1);
  assert.ok(utterance.hasAudio());
  assert.ok(Buffer.isBuffer(utterance.audioAlignment.audio));
  assert.ok(utterance.audioAlignment.durationMs > 0);
});

//// 后端缺失时合成不改发言,留无音频 [@busybee 2026-06-13] ////
test('synthesize leaves the utterance untouched when no backend is injected', () => {
  const orch = new TtsOrchestrator({ speechBackend: null });
  const utterance = Utterance.of('text');
  orch.synthesize(utterance);
  assert.strictEqual(utterance.audioAlignment, null);
});

//// 所有分句合成都失败时不回填音频对齐 [@busybee 2026-06-13] ////
test('synthesize leaves no alignment when every chunk fails', () => {
  const { backend } = makeBackend({ synthesize: () => null });
  const orch = new TtsOrchestrator({ speechBackend: backend });
  const utterance = Utterance.of('text');
  orch.synthesize(utterance);
  assert.strictEqual(utterance.audioAlignment, null);
});

//// 部分分句合成失败时只拼接成功的那些 [@busybee 2026-06-13] ////
test('synthesize concatenates only the chunks that succeeded', () => {
  let nth = 0;
  const { backend } = makeBackend({
    synthesize: () => {
      nth += 1;
      return nth === 1 ? null : makeWav({ sampleRate: 24000, pcmLen: 48000 });
    },
  });
  const orch = new TtsOrchestrator({ speechBackend: backend, maxChunkLen: 2 });
  const utterance = Utterance.of('あ。い。う。え');
  orch.synthesize(utterance);
  assert.ok(utterance.hasAudio());
});
