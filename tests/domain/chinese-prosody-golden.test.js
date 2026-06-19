// 中文韵律重构护栏:加载冻结的金标准 fixture,纯跑 applyChineseProsody 比对定稿输出,拆分重构后须逐字一致。
// 另校验模块导出面完整,防拆分时漏掉某个 re-export。fixture 由 archive/_gen_golden.js 从拆分前代码生成。
const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const mod = require('../../src/domain/tts/chinese-phonemes');
const { applyChineseProsody } = mod;

const golden = JSON.parse(fs.readFileSync(path.join(__dirname, 'fixtures', 'chinese-prosody.golden.json'), 'utf8'));

const clone = (o) => JSON.parse(JSON.stringify(o));
const round = (o) => {
  if (typeof o === 'number') return Math.round(o * 1e4) / 1e4;
  if (Array.isArray(o)) return o.map(round);
  if (o && typeof o === 'object') { const r = {}; for (const k of Object.keys(o)) r[k] = round(o[k]); return r; }
  return o;
};

//// 逐例重跑 applyChineseProsody,定稿输出须与金标准逐字一致 [@x380kkm 2026-06-19] ////
for (const c of golden.cases) {
  test(`金标准 applyChineseProsody 不变:${c.name}`, () => {
    const q = clone(c.inputQuery);
    applyChineseProsody(q, c.plan, golden.config);
    assert.deepStrictEqual(round(q), c.expected, `${c.name}「${c.text}」韵律输出偏离金标准`);
  });
}
//// /逐例重跑 applyChineseProsody ////

//// 导出面完整:拆分重构后这些符号须仍从入口导出,漏一个即报错 [@x380kkm 2026-06-19] ////
const EXPORTED_FUNCTIONS = [
  'parsePinyin', 'isPunctuation', 'syllableToKana', 'sentenceToAccentKana', 'mandarinTone',
  'applyMandarinTones', 'flowPhrases', 'shapeChineseRhythm', 'sizePhrasePauses', 'splitFinalAspiratedStop',
  'normalizeSyllableDurations', 'shortenElongationPad', 'extendPrePausal', 'sustainFinalNeutral',
  'tightenGlideMedial', 'fitSyllableDuration', 'adjustNasalCoda', 'apicalizeEmptyRhyme', 'tightenErhuaTail',
  'bolsterNgVowel', 'balanceUoGlide', 'bolsterUnVowel', 'distributeBareYiGlide', 'shortenDiphthongOffGlide',
  'floorGlideOnset', 'capNasalCoda', 'enforceMinDuration', 'ensureMainVowelShare', 'applyToneRangeScale',
  'softCapToneRange', 'sizeSokuon', 'isHomorganicLiaison', 'drawToneContours', 'applyDeclination',
  'applyBaselineContour', 'applyFocus', 'applySentenceIntonation', 'applyChineseProsody', 'moraCount',
  'chineseVoicePitch', 'chineseVoiceSpeed',
];
const EXPORTED_OBJECTS = ['CHINESE_QUERY_DEFAULTS', 'CHINESE_VOICE_PITCH', 'CHINESE_VOICE_SPEED', 'INITIAL_CV', 'FINAL_KANA'];

test('入口导出面完整', () => {
  for (const name of EXPORTED_FUNCTIONS) assert.strictEqual(typeof mod[name], 'function', `缺函数导出 ${name}`);
  for (const name of EXPORTED_OBJECTS) assert.strictEqual(typeof mod[name], 'object', `缺数据导出 ${name}`);
});
//// /导出面完整 ////
