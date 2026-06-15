// audience: internal
// # chinese-text
// 把任意中文文本转成带声调拼音 token 序列,交 chinese-phonemes 的 sentenceToAccentKana 拼日文音素合成。
// 汉字转拼音用 pinyin-pro,自带按词消歧的多音字处理(银行 hang、行走 xing、重要 zhong、重复 chong);
// 标点保留(在凑音素层驱动停顿),拉丁字母、数字等不发音的字符跳过。
// 不变量:第三方 pinyin-pro 只在本文件出现,其余代码看到的是 token 序列;轻声记声调 5;输出无副作用纯函数。

const { pinyin } = require('pinyin-pro');
const { isPunctuation, sentenceToAccentKana } = require('./chinese-phonemes');

// 一个 token 是不是汉字转出的带声调拼音:字母串后必带一位声调数字(0 到 5),据此与残留的拉丁字母、符号区分。
const TONED_PINYIN = /^([a-zü]+)([0-5])$/i;

//// 把任意中文文本转成拼音与标点 token 序列:汉字转带声调拼音、标点保留、其余不发音的字符跳过 [@busybee 2026-06-15] ////
// pinyin-pro 以 nonZh:'consonant' 把非汉字逐字符单列,汉字拼音必带声调数字;轻声 pinyin-pro 记 0,这里统一成 5。
function textToPinyinTokens(text) {
  const raw = pinyin(String(text || ''), { toneType: 'num', type: 'array', nonZh: 'consonant' });
  const tokens = [];
  for (const tok of raw) {
    if (isPunctuation(tok)) {
      tokens.push(tok);
      continue;
    }
    const matched = TONED_PINYIN.exec(tok);
    if (matched) {
      const tone = matched[2] === '0' ? '5' : matched[2];
      tokens.push(matched[1].toLowerCase() + tone);
    }
    // 其它字符(拉丁字母、阿拉伯数字、空格、符号)不发音,跳过。
  }
  return tokens;
}
//// /把任意中文文本转成拼音与标点 token 序列 ////

//// 把任意中文文本直接转成带重音片假名与声调计划,供后端取 audio_query 合成 [@busybee 2026-06-15] ////
function textToAccentKana(text, options = {}) {
  return sentenceToAccentKana(textToPinyinTokens(text), options);
}
//// /把任意中文文本直接转成带重音片假名与声调计划 ////

module.exports = { textToPinyinTokens, textToAccentKana };
