// audience: internal
// # tone-map
// 情绪到语气的映射:把情绪名折成 audio_query 的语气字段(语调强度、前后停顿),供可选的 TTS 语气控制用。
// 不变量:纯函数无副作用;未知或空情绪返回 null 表示不叠加语气;只产出 VOICEVOX 通用的标量字段,不碰每个 mora 的细节。
//
// intonationScale 是语调强度,基准 1.0;prePhonemeLength 与 postPhonemeLength 是发声前后的停顿秒数,基准约 0.1。
// 情绪名用英文小写匹配(与 emotion-selector 的常见取值一致);自定义或他语种情绪名匹配不到时返回 null,合成退回无语气,这是安全默认。

// 情绪名到语气字段的映射表。
const TONE_BY_EMOTION = Object.freeze({
  happy: { intonationScale: 1.3, prePhonemeLength: 0.08, postPhonemeLength: 0.08 },
  excited: { intonationScale: 1.45, prePhonemeLength: 0.05, postPhonemeLength: 0.05 },
  surprised: { intonationScale: 1.4, prePhonemeLength: 0.05, postPhonemeLength: 0.1 },
  angry: { intonationScale: 1.3, prePhonemeLength: 0.05, postPhonemeLength: 0.05 },
  sad: { intonationScale: 0.75, prePhonemeLength: 0.15, postPhonemeLength: 0.2 },
  gloomy: { intonationScale: 0.7, prePhonemeLength: 0.15, postPhonemeLength: 0.2 },
  calm: { intonationScale: 0.95, prePhonemeLength: 0.15, postPhonemeLength: 0.15 },
  shy: { intonationScale: 0.9, prePhonemeLength: 0.12, postPhonemeLength: 0.15 }
});

//// 取某情绪名对应的语气字段,未知或空名返回 null [@busybee 2026-06-14] ////
function toneFor(emotionName) {
  if (!emotionName) {
    return null;
  }
  const tone = TONE_BY_EMOTION[String(emotionName).toLowerCase()];
  return tone ? { ...tone } : null;
}
//// /取某情绪名对应的语气字段 ////

module.exports = { toneFor, TONE_BY_EMOTION };
