// audience: internal
// # prosody-shaper
// 韵律塑形:在 audio_query 上做句内与句间微调,情绪只在用户选定声线上生效,不切换声线。
// 不变量:纯函数,原地改 query 的 accent_phrases 后返回;无 tone 时不动;只改 mora 的 pitch 与时长、句间 pause_mora。
//
// 人声是平直占主体、情绪在关键处突出。故所有逐句参数都由同一条强度包络驱动,不单独处理:
// 锚点句(首句、末句、疑问句)强度为 1,其余句按到最近锚点的距离做高斯衰减回落到 baseIntensity,过渡平滑。
// 每句按各自强度把这些量从中性插值到目标:contour 句内起伏、pitchLift 整句抬音、lengthMul 句内语速、
// pauseMul 句间停顿倍率、末句的 endFall/endRise/endLengthen。音量包络在波形层另算,整段首尾停顿由 _applyTone 处理。

//// 算逐句的情绪强度包络:锚点句为 1,其余按到最近锚点的距离高斯衰减到 baseIntensity [@busybee 2026-06-14] ////
// 锚点取首句、末句与各疑问句;sigma 越大过渡越宽。
function envelope(phrases, base, sigma) {
  const n = phrases.length;
  if (n === 0) {
    return [];
  }
  const anchors = new Set([0, n - 1]);
  phrases.forEach((phrase, i) => {
    if (phrase.is_interrogative) anchors.add(i);
  });
  const anchorList = [...anchors];
  return phrases.map((_, i) => {
    let proximity = 0;
    for (const a of anchorList) {
      const d = i - a;
      proximity = Math.max(proximity, Math.exp(-(d * d) / (2 * sigma * sigma)));
    }
    return base + (1 - base) * proximity;
  });
}
//// /算逐句的情绪强度包络 ////

//// 把一句有声 mora 的音高偏离按系数缩放,均值不变、起伏随系数增减 [@busybee 2026-06-14] ////
function shapeContour(phrase, contour) {
  const voiced = (phrase.moras || []).filter((m) => m.pitch > 0);
  if (voiced.length < 2) {
    return;
  }
  const mean = voiced.reduce((sum, m) => sum + m.pitch, 0) / voiced.length;
  for (const mora of voiced) {
    mora.pitch = mean + (mora.pitch - mean) * contour;
  }
}
//// /把一句有声 mora 的音高偏离按系数缩放 ////

//// 给一句所有有声 mora 抬同一音高增量,使锚点句整体更突出 [@busybee 2026-06-14] ////
function applyPitchLift(phrase, lift) {
  for (const mora of phrase.moras || []) {
    if (mora.pitch > 0) mora.pitch = Math.max(0.1, mora.pitch + lift);
  }
}
//// /给一句所有有声 mora 抬同一音高增量 ////

//// 把一句各 mora 的辅元音时长按倍率缩放,实现句内语速 [@busybee 2026-06-14] ////
function applyLength(phrase, mul) {
  for (const mora of phrase.moras || []) {
    if (mora.consonant_length) mora.consonant_length *= mul;
    if (mora.vowel_length) mora.vowel_length *= mul;
  }
}
//// /把一句各 mora 的辅元音时长按倍率缩放 ////

//// 调最后一句末音节的走向:疑问句升、陈述句降,并按系数延长,均按强度 k 缩放 [@busybee 2026-06-14] ////
function shapeFinal(phrase, tone, k) {
  const voiced = (phrase.moras || []).filter((m) => m.pitch > 0);
  if (voiced.length === 0) {
    return;
  }
  const last = voiced[voiced.length - 1];
  if (phrase.is_interrogative) {
    if (tone.endRise != null) last.pitch += tone.endRise * k;
  } else if (tone.endFall != null) {
    last.pitch = Math.max(0.1, last.pitch - tone.endFall * k);
  }
  if (tone.endLengthen != null) {
    last.vowel_length *= 1 + (tone.endLengthen - 1) * k;
  }
}
//// /调最后一句末音节的走向 ////

//// 在 query 上按强度包络逐句塑形:所有逐句量从中性按强度插值到目标 [@busybee 2026-06-14] ////
function shape(query, tone) {
  if (!query || !query.accent_phrases || !tone) {
    return query;
  }
  const phrases = query.accent_phrases;
  const base = tone.baseIntensity != null ? tone.baseIntensity : 0.35;
  const sigma = tone.envelopeSigma != null ? tone.envelopeSigma : 1.5;
  const intensities = envelope(phrases, base, sigma);
  phrases.forEach((phrase, index) => {
    const k = intensities[index];
    if (tone.contour != null) shapeContour(phrase, 1 + (tone.contour - 1) * k);
    if (tone.pitchLift != null) applyPitchLift(phrase, tone.pitchLift * k);
    if (tone.lengthMul != null) applyLength(phrase, 1 + (tone.lengthMul - 1) * k);
    if (phrase.pause_mora && tone.pauseMul != null) {
      phrase.pause_mora.vowel_length *= 1 + (tone.pauseMul - 1) * k;
    }
    if (index === phrases.length - 1) shapeFinal(phrase, tone, k);
  });
  return query;
}
//// /在 query 上按强度包络逐句塑形 ////

//// 算逐句的音量增益段:由强度包络在 volBody 与 volPeak 间插值,供合成后按段对波形加增益 [@busybee 2026-06-14] ////
// audio_query 只有全局音量,故音量包络落在波形层:返回每段的时长与增益;无 volPeak 时返回 null。
function volumeGainSpans(query, tone) {
  if (!query || !query.accent_phrases || !tone || tone.volPeak == null) {
    return null;
  }
  const phrases = query.accent_phrases;
  const base = tone.baseIntensity != null ? tone.baseIntensity : 0.35;
  const sigma = tone.envelopeSigma != null ? tone.envelopeSigma : 1.5;
  const intensities = envelope(phrases, base, sigma);
  const speed = query.speedScale || 1;
  const body = tone.volBody != null ? tone.volBody : 1;
  const pre = query.prePhonemeLength || 0;
  const post = query.postPhonemeLength || 0;
  return phrases.map((phrase, i) => {
    let dur = 0;
    for (const m of phrase.moras || []) {
      dur += (m.consonant_length || 0) + (m.vowel_length || 0);
    }
    if (phrase.pause_mora && phrase.pause_mora.vowel_length) {
      dur += phrase.pause_mora.vowel_length;
    }
    if (i === 0) dur += pre;
    if (i === phrases.length - 1) dur += post;
    return { durationSec: dur / speed, gain: body + (tone.volPeak - body) * intensities[i] };
  });
}
//// /算逐句的音量增益段 ////

//// 整合:在 query 上做韵律塑形,并算出音量增益段供合成后施加 [@busybee 2026-06-14] ////
function apply(query, tone) {
  shape(query, tone);
  return volumeGainSpans(query, tone);
}
//// /整合 ////

module.exports = { shape, apply, volumeGainSpans, shapeContour, shapeFinal, applyLength, envelope };
