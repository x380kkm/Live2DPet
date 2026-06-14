// audience: internal
// # tone-map
// 情绪到语气微调的映射:在用户选定的声线(styleId)上做模型内微调,不切换声线或角色。
// 不变量:纯函数无副作用;未知或空情绪返回 null 表示不微调;只产出叠加到 audio_query 的参数,声线由用户在设置里选定。
//
// 逐句量(由 prosody-shaper 按强度包络从中性插值到目标):contour 句内音高起伏系数;pitchLift 整句抬音;
//   lengthMul 句内语速(音节时长倍率,大于 1 更慢);pauseMul 句间停顿倍率(乘自然停顿,不覆盖,保留长短变化);
//   endFall 与 endRise 设末句句尾降升;endLengthen 延长末音节;volBody 与 volPeak 是音量包络两端,由波形层按段加增益;
//   baseIntensity 是非锚点句回落到的基线强度;envelopeSigma 是包络过渡宽度。
// 全局量(由 voicevox-backend._applyTone 叠在用户基值上):prePhonemeLength 与 postPhonemeLength 设整段首尾停顿;
//   分块合成时每块都带这对留白,故取小值以免块间堆出过多静音。
// 高能情绪用低 baseIntensity,情绪集中在锚点峰起;低能情绪用高 baseIntensity,低落弥漫全段。
// 情绪名用英文小写匹配;匹配不到返回 null,合成退回用户基值,这是安全默认。

// 情绪名到模型内微调量的映射表。
const TONE_BY_EMOTION = Object.freeze({
  happy: { volBody: 0.9, volPeak: 1.12, prePhonemeLength: 0.03, postPhonemeLength: 0.03, contour: 1.2, pitchLift: 0.04, lengthMul: 0.97, baseIntensity: 0.35, envelopeSigma: 1.5, endFall: 0.05, endRise: 0.05, endLengthen: 1.05, pauseMul: 0.92 },
  excited: { volBody: 0.92, volPeak: 1.18, prePhonemeLength: 0.02, postPhonemeLength: 0.02, contour: 1.45, pitchLift: 0.06, lengthMul: 0.91, baseIntensity: 0.4, envelopeSigma: 1.4, endFall: 0.0, endRise: 0.12, endLengthen: 1.0, pauseMul: 0.8 },
  surprised: { volBody: 0.88, volPeak: 1.15, prePhonemeLength: 0.03, postPhonemeLength: 0.05, contour: 1.4, pitchLift: 0.06, lengthMul: 1.0, baseIntensity: 0.3, envelopeSigma: 1.2, endFall: 0.0, endRise: 0.18, endLengthen: 1.05, pauseMul: 0.9 },
  angry: { volBody: 0.95, volPeak: 1.15, prePhonemeLength: 0.02, postPhonemeLength: 0.03, contour: 1.3, pitchLift: 0.0, lengthMul: 0.93, baseIntensity: 0.45, envelopeSigma: 1.5, endFall: 0.08, endRise: 0.05, endLengthen: 0.95, pauseMul: 0.82 },
  sad: { volBody: 0.8, volPeak: 0.92, prePhonemeLength: 0.05, postPhonemeLength: 0.08, contour: 0.82, pitchLift: -0.02, lengthMul: 1.14, baseIntensity: 0.7, envelopeSigma: 2.0, endFall: 0.03, endRise: 0.0, endLengthen: 1.35, pauseMul: 1.12 },
  gloomy: { volBody: 0.78, volPeak: 0.9, prePhonemeLength: 0.05, postPhonemeLength: 0.1, contour: 0.75, pitchLift: -0.03, lengthMul: 1.18, baseIntensity: 0.7, envelopeSigma: 2.0, endFall: 0.04, endRise: 0.0, endLengthen: 1.4, pauseMul: 1.18 },
  calm: { volBody: 0.88, volPeak: 0.98, prePhonemeLength: 0.04, postPhonemeLength: 0.05, contour: 1.2, pitchLift: 0.0, lengthMul: 1.05, baseIntensity: 0.6, envelopeSigma: 2.0, endFall: 0.05, endRise: 0.0, endLengthen: 1.15, pauseMul: 1.05 },
  shy: { volBody: 0.82, volPeak: 0.95, prePhonemeLength: 0.04, postPhonemeLength: 0.05, contour: 0.85, pitchLift: 0.0, lengthMul: 1.09, baseIntensity: 0.6, envelopeSigma: 1.8, endFall: 0.04, endRise: 0.0, endLengthen: 1.15, pauseMul: 1.05 }
});

//// 取某情绪名对应的模型内微调量,未知或空名返回 null [@busybee 2026-06-14] ////
function toneFor(emotionName) {
  if (!emotionName) {
    return null;
  }
  const tone = TONE_BY_EMOTION[String(emotionName).toLowerCase()];
  return tone ? { ...tone } : null;
}
//// /取某情绪名对应的模型内微调量 ////

module.exports = { toneFor, TONE_BY_EMOTION };
