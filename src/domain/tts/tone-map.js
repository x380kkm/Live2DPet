// audience: internal
// # tone-map
// 情绪到语气微调的映射:在用户选定的声线(styleId)上做模型内微调,不切换声线或角色。
// 不变量:纯函数无副作用;未知或空情绪返回 null 表示不微调;只产出叠加到 audio_query 的参数,声线由用户在设置里选定。
//
// 标量(由 voicevox-backend._applyTone 叠在用户基值上):intonationScale 设语调强度;pitchDelta 加到基础音高;
//   speedMul 乘基础语速;volumeMul 乘基础音量;prePhonemeLength 与 postPhonemeLength 设整段前后停顿。
// 韵律(由 prosody-shaper 按强度包络逐句生效):contour 是锚点句的音高起伏系数;pitchLift 是锚点句的整体抬音;
//   baseIntensity 是非锚点句回落到的基线强度(越低中段越平直);envelopeSigma 是包络过渡宽度;
//   endFall 与 endRise 设末句句尾降升;endLengthen 延长末音节;pausePad 统一句间停顿。
// 高能情绪用低 baseIntensity,情绪集中在锚点峰起;低能情绪用高 baseIntensity,低落弥漫全段。
// 情绪名用英文小写匹配;匹配不到返回 null,合成退回用户基值,这是安全默认。

// 情绪名到模型内微调量的映射表。
const TONE_BY_EMOTION = Object.freeze({
  happy: { intonationScale: 1.15, pitchDelta: 0.02, speedMul: 1.03, volumeMul: 1.0, prePhonemeLength: 0.08, postPhonemeLength: 0.1, contour: 1.2, pitchLift: 0.04, baseIntensity: 0.35, envelopeSigma: 1.5, endFall: 0.05, endRise: 0.05, endLengthen: 1.05, pausePad: 0.2 },
  excited: { intonationScale: 1.4, pitchDelta: 0.04, speedMul: 1.1, volumeMul: 1.05, prePhonemeLength: 0.05, postPhonemeLength: 0.05, contour: 1.45, pitchLift: 0.06, baseIntensity: 0.4, envelopeSigma: 1.4, endFall: 0.0, endRise: 0.12, endLengthen: 1.0, pausePad: 0.13 },
  surprised: { intonationScale: 1.4, pitchDelta: 0.04, speedMul: 1.0, volumeMul: 1.02, prePhonemeLength: 0.05, postPhonemeLength: 0.12, contour: 1.4, pitchLift: 0.06, baseIntensity: 0.3, envelopeSigma: 1.2, endFall: 0.0, endRise: 0.18, endLengthen: 1.05, pausePad: 0.15 },
  angry: { intonationScale: 1.35, pitchDelta: 0.0, speedMul: 1.08, volumeMul: 1.08, prePhonemeLength: 0.04, postPhonemeLength: 0.05, contour: 1.3, pitchLift: 0.0, baseIntensity: 0.45, envelopeSigma: 1.5, endFall: 0.08, endRise: 0.05, endLengthen: 0.95, pausePad: 0.12 },
  sad: { intonationScale: 0.8, pitchDelta: -0.04, speedMul: 0.88, volumeMul: 0.85, prePhonemeLength: 0.15, postPhonemeLength: 0.22, contour: 0.82, pitchLift: -0.02, baseIntensity: 0.7, envelopeSigma: 2.0, endFall: 0.03, endRise: 0.0, endLengthen: 1.35, pausePad: 0.32 },
  gloomy: { intonationScale: 0.7, pitchDelta: -0.05, speedMul: 0.85, volumeMul: 0.82, prePhonemeLength: 0.15, postPhonemeLength: 0.24, contour: 0.75, pitchLift: -0.03, baseIntensity: 0.7, envelopeSigma: 2.0, endFall: 0.04, endRise: 0.0, endLengthen: 1.4, pausePad: 0.34 },
  calm: { intonationScale: 0.95, pitchDelta: -0.01, speedMul: 0.95, volumeMul: 0.95, prePhonemeLength: 0.13, postPhonemeLength: 0.15, contour: 0.9, pitchLift: -0.01, baseIntensity: 0.6, envelopeSigma: 2.0, endFall: 0.05, endRise: 0.0, endLengthen: 1.15, pausePad: 0.25 },
  shy: { intonationScale: 0.9, pitchDelta: 0.01, speedMul: 0.92, volumeMul: 0.9, prePhonemeLength: 0.12, postPhonemeLength: 0.15, contour: 0.85, pitchLift: 0.0, baseIntensity: 0.6, envelopeSigma: 1.8, endFall: 0.04, endRise: 0.0, endLengthen: 1.15, pausePad: 0.25 }
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
