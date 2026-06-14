// audience: internal
// # prosody-shaper
// 韵律塑形:在 audio_query 上做句内与句间微调,情绪只在用户选定声线上生效,不切换声线。
// 不变量:纯函数,原地改 query 的 accent_phrases 后返回;无 tone 时不动;只改 mora 的 pitch 与时长、句间 pause_mora。
//
// 人声不是把情绪均匀抹满全句:平直占主体,情绪在关键处突出,之间平滑过渡。
// 故按强度包络逐句调:锚点句(首句、末句、疑问句)情绪满,其余句按到锚点的距离做高斯衰减回落到基线强度,过渡平滑。
// 句内:每句把有声 mora 的音高偏离按(随强度插值的)contour 缩放,锚点句加 pitchLift 抬音,末句按陈述或疑问调句尾。
// 句间:把各句 pause_mora 统一到 pausePad,使长输出换气均匀。
// tone 字段(由 tone-map 给):contour、pitchLift、baseIntensity、envelopeSigma、endFall、endRise、endLengthen、pausePad。

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
  if (voiced.length < 2 || contour == null) {
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

//// 调最后一句末音节的走向:疑问句升、陈述句降,并按系数延长 [@busybee 2026-06-14] ////
function shapeFinal(phrase, tone) {
  const voiced = (phrase.moras || []).filter((m) => m.pitch > 0);
  if (voiced.length === 0) {
    return;
  }
  const last = voiced[voiced.length - 1];
  if (phrase.is_interrogative) {
    if (tone.endRise != null) last.pitch += tone.endRise;
  } else if (tone.endFall != null) {
    last.pitch = Math.max(0.1, last.pitch - tone.endFall);
  }
  if (tone.endLengthen != null) {
    last.vowel_length *= tone.endLengthen;
  }
}
//// /调最后一句末音节的走向 ////

//// 在 query 上按强度包络逐句塑形:中段平直、锚点突出、过渡平滑,并统一句间停顿 [@busybee 2026-06-14] ////
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
    if (tone.contour != null) {
      shapeContour(phrase, 1 + (tone.contour - 1) * k);
    }
    if (tone.pitchLift != null) {
      applyPitchLift(phrase, tone.pitchLift * k);
    }
    if (phrase.pause_mora && tone.pausePad != null) {
      phrase.pause_mora.vowel_length = tone.pausePad;
    }
    if (index === phrases.length - 1) {
      shapeFinal(phrase, tone);
    }
  });
  return query;
}
//// /在 query 上按强度包络逐句塑形 ////

module.exports = { shape, shapeContour, shapeFinal, envelope };
