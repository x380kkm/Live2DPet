// audience: internal
// # chinese-phonemes
// 中文凑音素层的公共入口:组合各子模块(chinese-tables/pinyin-kana/tone-pitch/syllable-timing),
// 对外提供拼音到片假名的拼装与按中文韵律整形 query 的 applyChineseProsody 流水线,并原样重导出各层公开符号。
// VOICEVOX 是日语模型,中文靠这层近似,听感靠耳朵迭代收敛。
// 不变量:纯逻辑无副作用;流水线调用顺序固定(见 applyChineseProsody);音高按 query 自身均值相对调整,适配不同声线。

const { CHINESE_QUERY_DEFAULTS, CHINESE_VOICE_PITCH, CHINESE_VOICE_SPEED, FINAL_KANA, INITIAL_CV, chineseVoicePitch, chineseVoiceSpeed } = require('./chinese-tables');
const { isHomorganicLiaison, isPunctuation, moraCount, parsePinyin, sentenceToAccentKana, syllableToKana } = require('./pinyin-kana');
const { adjustNasalCoda, apicalizeEmptyRhyme, balanceUoGlide, bolsterNgVowel, bolsterUnVowel, capNasalCoda, distributeBareYiGlide, enforceMinDuration, ensureMainVowelShare, extendPrePausal, fitSyllableDuration, floorGlideOnset, flowPhrases, normalizeSyllableDurations, shapeChineseRhythm, shortenDiphthongOffGlide, shortenElongationPad, sizePhrasePauses, sizeSokuon, splitFinalAspiratedStop, sustainFinalNeutral, tightenErhuaTail, tightenGlideMedial } = require('./syllable-timing');
const { applyBaselineContour, applyDeclination, applyFocus, applyMandarinTones, applySentenceIntonation, applyToneRangeScale, drawToneContours, mandarinTone, softCapToneRange } = require('./tone-pitch');

//// 把一份 audio_query 按中文韵律整形:铺四声、连读收停顿、拉平时长、缩补拍、停顿前延长、句末轻声撑住、句末送气字落到短语首、二三声画调型、整句下倾、按句类型铺句调 [@x380kkm 2026-06-15] ////
// 中文凑音素的整条韵律流水线,顺序固定:先铺四声音高(默认带 downstep:三声把其后高调压一级再回升),再合并组内短语收停顿,
// 再拉平各音节时长匀节奏,再把单元音补拍压短,再把停顿前实词延长、句末轻声撑住,再把句末送气字切到短语首送气,
// 再压短滑音介音,再给二声画升、三声画曲折(这步重排 mora),最后按句类型铺句调收住句末(是非问上扬、陈述与特指问压低)。
// 句内下行用 downstep(默认开),它替代整句线性下倾——两者一起会重复压、压过头;显式传 config.downstep 为 null 可关 downstep、回退线性下倾。
// query 需已铺好 CHINESE_QUERY_DEFAULTS;config 透传给各步。音量回拉是合成后的 PCM 处理,不在这条流水线里。
function applyChineseProsody(query, plan, config = {}) {
  const useDownstep = config.downstep !== null && config.downstep !== false;
  const toneConfig = useDownstep ? { ...config, downstep: config.downstep || {} } : { ...config, downstep: undefined };
  applyMandarinTones(query, plan, toneConfig);
  shapeChineseRhythm(query, config);
  sizePhrasePauses(query, plan, config);
  normalizeSyllableDurations(query, plan, config);
  shortenElongationPad(query, config);
  extendPrePausal(query, plan, config);
  sustainFinalNeutral(query, plan, config);
  splitFinalAspiratedStop(query, plan);
  tightenGlideMedial(query, plan, config);
  fitSyllableDuration(query, plan, config);
  adjustNasalCoda(query, plan, config);
  drawToneContours(query, plan, config);
  // downstep 开时不叠线性下倾(避免重复计提);关时走线性下倾兜底。
  if (!useDownstep) applyDeclination(query, plan, config);
  applyBaselineContour(query, config);
  applyFocus(query, plan, config);
  applySentenceIntonation(query, plan, config);
  applyToneRangeScale(query, config); // 先整体收窄起伏(默认 0.65),让字调变化小一点
  softCapToneRange(query, config); // 再软压上下两端极端、保中段(只相对锚定,不改整体音高)
  apicalizeEmptyRhyme(query, plan, config);
  tightenErhuaTail(query, plan, config);
  bolsterNgVowel(query, plan, config);
  balanceUoGlide(query, plan, config);
  bolsterUnVowel(query, plan, config);
  distributeBareYiGlide(query, plan, config); // 须在所有改 vowel_length 的步之后:按定稿总长再切 ユ/イ 比例
  shortenDiphthongOffGlide(query, plan, config); // 须在画调型(复制 mora)之后:把 ai/ei 尾 [i] 收成极短滑音
  floorGlideOnset(query, plan, config); // 零声母介音字首拍介音保底,免得又塌成欧
  capNasalCoda(query, plan, config); // 须在 adjustNasalCoda/bolsterNgVowel 之后兜底封顶鼻尾
  sizeSokuon(query, plan, config);
  ensureMainVowelShare(query, plan, config); // 保障主元音占比,免得被声母/鼻尾/滑音挤太短
  enforceMinDuration(query, plan, config); // 最末尾:把被后续步砍到下限以下的字补回主元音
  // 收尾:画调型重排 mora 后,短语原有的重音核位置可能超过新的 mora 数,引擎会告警「accent 超过 mora 数」。
  // 中文路径逐 mora 显式铺了音高、不靠重音核,这里把 accent 夹回合法范围消除告警。
  for (const phrase of (query.accent_phrases || [])) {
    const moraN = (phrase.moras || []).length;
    if (phrase.accent > moraN) phrase.accent = moraN;
    if (phrase.accent < 0) phrase.accent = 0;
  }
  return query;
}
//// /把一份 audio_query 按中文韵律整形 ////

module.exports = {
  parsePinyin,
  isPunctuation,
  syllableToKana,
  sentenceToAccentKana,
  mandarinTone,
  applyMandarinTones,
  flowPhrases,
  shapeChineseRhythm,
  sizePhrasePauses,
  splitFinalAspiratedStop,
  normalizeSyllableDurations,
  shortenElongationPad,
  extendPrePausal,
  sustainFinalNeutral,
  tightenGlideMedial,
  fitSyllableDuration,
  adjustNasalCoda,
  apicalizeEmptyRhyme,
  tightenErhuaTail,
  bolsterNgVowel,
  balanceUoGlide,
  bolsterUnVowel,
  distributeBareYiGlide,
  shortenDiphthongOffGlide,
  floorGlideOnset,
  capNasalCoda,
  enforceMinDuration,
  ensureMainVowelShare,
  applyToneRangeScale,
  softCapToneRange,
  sizeSokuon,
  isHomorganicLiaison,
  drawToneContours,
  applyDeclination,
  applyBaselineContour,
  applyFocus,
  applySentenceIntonation,
  applyChineseProsody,
  moraCount,
  CHINESE_QUERY_DEFAULTS,
  CHINESE_VOICE_PITCH,
  chineseVoicePitch,
  CHINESE_VOICE_SPEED,
  chineseVoiceSpeed,
  INITIAL_CV,
  FINAL_KANA,
};
