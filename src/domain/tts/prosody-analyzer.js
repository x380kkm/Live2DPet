// audience: internal
// # prosody-analyzer
// 韵律分析:从 audio_query 量出可比较的语音特征,供判断语音情况与迭代调参。
// 不变量:纯函数无副作用;只读 query 的 accent_phrases 与标量字段,不调引擎、不碰 FFI、不读 WAV。
//
// 量出的特征:音节数、实际时长(按语速缩放)、语速、音高均值与起伏(极差与标准差)、句尾相对均值的走向、句间停顿数与总长均长。
// 这些数值让我不靠人工试听就能比较两版合成的差异,据此调塑形参数,逐步沉淀每种情绪的韵律 fewshot。

//// 求一组数的均值,空集计零 [@busybee 2026-06-14] ////
function mean(xs) {
  return xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : 0;
}

//// 求一组数相对给定均值的标准差,空集计零 [@busybee 2026-06-14] ////
function stdDev(xs, m) {
  return xs.length ? Math.sqrt(mean(xs.map((x) => (x - m) * (x - m)))) : 0;
}

//// 从 audio_query 量出韵律特征 [@busybee 2026-06-14] ////
function analyze(query) {
  const phrases = (query && query.accent_phrases) || [];
  const pitches = [];
  const pauses = [];
  let rawDur = 0;
  let moraCount = 0;
  let lastVoicedPitch = 0;

  for (const phrase of phrases) {
    for (const m of phrase.moras || []) {
      moraCount += 1;
      rawDur += (m.consonant_length || 0) + (m.vowel_length || 0);
      if (m.pitch > 0) {
        pitches.push(m.pitch);
        lastVoicedPitch = m.pitch;
      }
    }
    if (phrase.pause_mora && phrase.pause_mora.vowel_length) {
      pauses.push(phrase.pause_mora.vowel_length);
      rawDur += phrase.pause_mora.vowel_length;
    }
  }

  const pre = (query && query.prePhonemeLength) || 0;
  const post = (query && query.postPhonemeLength) || 0;
  const speed = (query && query.speedScale) || 1;
  const pitchShift = (query && query.pitchScale) || 0;
  const pitchMean = mean(pitches);
  // 实际时长按语速缩放:语速越快总时长越短。
  const durationSec = (rawDur + pre + post) / (speed || 1);

  return {
    moraCount,
    durationSec,
    rateMoraPerSec: durationSec > 0 ? moraCount / durationSec : 0,
    pitchMean: pitchMean + pitchShift,
    pitchRange: pitches.length ? Math.max(...pitches) - Math.min(...pitches) : 0,
    pitchStd: stdDev(pitches, pitchMean),
    finalDelta: pitches.length ? lastVoicedPitch - pitchMean : 0,
    pauseCount: pauses.length,
    pauseTotalSec: pauses.reduce((a, b) => a + b, 0),
    pauseMeanSec: mean(pauses)
  };
}
//// /从 audio_query 量出韵律特征 ////

module.exports = { analyze };
