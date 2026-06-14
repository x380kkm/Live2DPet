// audience: internal
// # tone-map
// 情绪到语气微调的映射:在用户选定的声线(styleId)上做模型内微调,不切换声线或角色。
// 不变量:纯函数无副作用;未知或空情绪返回 null 表示不微调;只产出叠加到 audio_query 的参数,声线由用户在设置里选定。
//
// 产出的字段都是模型内微调量,叠加在用户的基值上:
//   intonationScale 直接设语调强度,基准 1.0;
//   pitchDelta 加到用户基础音高上(VOICEVOX 音高范围约 ±0.15);
//   speedMul 乘到用户基础语速上(基准 1.0);
//   prePhonemeLength 与 postPhonemeLength 直接设发声前后停顿秒数,基准约 0.1。
// 情绪名用英文小写匹配(与 emotion-selector 的常见取值一致);匹配不到时返回 null,合成退回用户基值,这是安全默认。

// 情绪名到模型内微调量的映射表。
const TONE_BY_EMOTION = Object.freeze({
  happy: { intonationScale: 1.3, pitchDelta: 0.03, speedMul: 1.06, prePhonemeLength: 0.08, postPhonemeLength: 0.08 },
  excited: { intonationScale: 1.5, pitchDelta: 0.05, speedMul: 1.12, prePhonemeLength: 0.05, postPhonemeLength: 0.05 },
  surprised: { intonationScale: 1.45, pitchDelta: 0.04, speedMul: 1.0, prePhonemeLength: 0.05, postPhonemeLength: 0.12 },
  angry: { intonationScale: 1.35, pitchDelta: 0.0, speedMul: 1.08, prePhonemeLength: 0.04, postPhonemeLength: 0.05 },
  sad: { intonationScale: 0.7, pitchDelta: -0.03, speedMul: 0.9, prePhonemeLength: 0.15, postPhonemeLength: 0.2 },
  gloomy: { intonationScale: 0.65, pitchDelta: -0.04, speedMul: 0.85, prePhonemeLength: 0.15, postPhonemeLength: 0.22 },
  calm: { intonationScale: 0.95, pitchDelta: -0.01, speedMul: 0.95, prePhonemeLength: 0.13, postPhonemeLength: 0.15 },
  shy: { intonationScale: 0.9, pitchDelta: 0.01, speedMul: 0.92, prePhonemeLength: 0.12, postPhonemeLength: 0.15 }
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
