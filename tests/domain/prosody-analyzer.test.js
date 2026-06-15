// audience: internal
// # prosody-analyzer.test
// 验证韵律分析:用合成 audio_query 断言音节数、停顿、时长、语速与音高起伏的量法,以及起伏大、语速快时特征的相对变化。

const { test } = require('node:test');
const assert = require('node:assert');
const { analyze } = require('../../src/domain/tts/prosody-analyzer');

//// 造一个 mora:给定音高与可选时长 [@x380kkm 2026-06-14] ////
function mora(pitch, vowelLength = 0.1, consonantLength = 0.05) {
  return { text: 'ア', vowel: 'a', pitch, vowel_length: vowelLength, consonant_length: consonantLength };
}

//// 造一个重音短语:给定 mora 列表与可选句间停顿 [@x380kkm 2026-06-14] ////
function phrase(moras, pauseSec = null) {
  return { moras, accent: 1, pause_mora: pauseSec != null ? mora(0, pauseSec, 0) : null, is_interrogative: false };
}

//// 造一份 audio_query:给定短语与可选标量覆盖 [@x380kkm 2026-06-14] ////
function query(phrases, scalars = {}) {
  return { accent_phrases: phrases, speedScale: 1, pitchScale: 0, prePhonemeLength: 0.1, postPhonemeLength: 0.1, ...scalars };
}

//// 量出音节数、停顿、时长、语速与音高均值 [@x380kkm 2026-06-14] ////
test('analyze 量出音节数、停顿、时长、语速与音高均值', () => {
  const q = query([
    phrase([mora(5.5), mora(5.7)], 0.2),
    phrase([mora(5.6), mora(0)])
  ]);
  const f = analyze(q);
  assert.strictEqual(f.moraCount, 4);
  assert.strictEqual(f.pauseCount, 1);
  assert.ok(Math.abs(f.pauseTotalSec - 0.2) < 1e-9);
  // 4 个 mora 各 0.15 秒共 0.6,加停顿 0.2,加前后各 0.1,共 1.0,语速 1 不缩放。
  assert.ok(Math.abs(f.durationSec - 1.0) < 1e-9);
  assert.ok(Math.abs(f.rateMoraPerSec - 4) < 1e-9);
  // 三个有声 mora 均值 5.6,无声 mora 不计入。
  assert.ok(Math.abs(f.pitchMean - 5.6) < 1e-6);
});

//// 起伏大的句子音高标准差更大 [@x380kkm 2026-06-14] ////
test('analyze 起伏大的句子 pitchStd 更大', () => {
  const flat = analyze(query([phrase([mora(5.6), mora(5.6), mora(5.6)])]));
  const lively = analyze(query([phrase([mora(5.2), mora(6.0), mora(5.4)])]));
  assert.ok(lively.pitchStd > flat.pitchStd, '起伏大的应有更大标准差');
});

//// 语速加快时实际时长变短 [@x380kkm 2026-06-14] ////
test('analyze 语速加快时实际时长变短', () => {
  const base = analyze(query([phrase([mora(5.5), mora(5.5)])], { speedScale: 1 }));
  const fast = analyze(query([phrase([mora(5.5), mora(5.5)])], { speedScale: 1.5 }));
  assert.ok(fast.durationSec < base.durationSec, '语速快应时长更短');
});
