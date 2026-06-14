// audience: internal
// # prosody-shaper
// 韵律塑形:在 audio_query 上做句内与句间微调,情绪只在用户选定声线上生效,不切换声线。
// 不变量:纯函数,原地改 query 的 accent_phrases 后返回;无 tone 时不动;只改 mora 的 pitch 与时长、句间 pause_mora。
//
// 句内:把每句有声 mora 的音高偏离按 contour 缩放(大于 1 更起伏、小于 1 更平),并按句尾走向调整最后一句末音节。
// 句间:把各句的 pause_mora 停顿统一到 pausePad,使长输出换气均匀、过渡平顺。
// tone 字段(由 tone-map 给):contour、endFall、endRise、endLengthen、pausePad;缺哪个就不动对应项。

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

//// 在 query 上做句内与句间塑形:逐句缩放音高曲线、统一句间停顿、调末句句尾 [@busybee 2026-06-14] ////
function shape(query, tone) {
  if (!query || !query.accent_phrases || !tone) {
    return query;
  }
  const phrases = query.accent_phrases;
  phrases.forEach((phrase, index) => {
    shapeContour(phrase, tone.contour);
    if (phrase.pause_mora && tone.pausePad != null) {
      phrase.pause_mora.vowel_length = tone.pausePad;
    }
    if (index === phrases.length - 1) {
      shapeFinal(phrase, tone);
    }
  });
  return query;
}
//// /在 query 上做句内与句间塑形 ////

module.exports = { shape, shapeContour, shapeFinal };
