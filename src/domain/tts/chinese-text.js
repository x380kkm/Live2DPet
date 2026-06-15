// audience: internal
// # chinese-text
// 把任意中文文本转成带声调拼音 token 序列(并标出词边界),交 chinese-phonemes 的 sentenceToAccentKana 拼日文音素合成。
// 汉字转拼音用 pinyin-pro,自带按词消歧的多音字处理(银行 hang、行走 xing、重要 zhong、重复 chong);
// 分词也用 pinyin-pro,给出词边界,让凑音素层按词切子短语、不从词中间断开(银行、图书馆不被拆)。
// 标点保留(在凑音素层驱动停顿),拉丁字母、数字等不发音的字符跳过。
// 不变量:第三方 pinyin-pro 只在本文件出现;轻声记声调 5;纯函数无副作用。

const { pinyin, segment } = require('pinyin-pro');
const { isPunctuation, sentenceToAccentKana } = require('./chinese-phonemes');

// 一个 token 是不是汉字转出的带声调拼音:字母串后必带一位声调数字(0 到 5),据此与残留的拉丁字母、符号区分。
const TONED_PINYIN = /^([a-zü]+)([0-5])$/i;

//// 把任意中文文本转成 { tokens, wordStart }:拼音与标点 token,以及每个 token 是否为一个词的开头 [@busybee 2026-06-15] ////
// pinyin-pro 以 nonZh:'consonant' 把非汉字逐字符单列、汉字拼音必带声调数字(轻声记 0,这里统一成 5);
// segment 给出按词切分,据各词起始字符位置标出词边界;两者都对齐到逐字符,据字符下标对应。
function textToTokens(text) {
  const str = String(text || '');
  const chars = Array.from(str);
  const perChar = pinyin(str, { toneType: 'num', type: 'array', nonZh: 'consonant' });
  // 逐字符标词首:segment 的每个词,其首字符位置记为词首。perChar 与 chars 逐字符对齐时按下标对应;
  // 否则、或分词出错(空串、纯符号会让 pinyin-pro 抛错)时,降级为每字符自成词(等长切)。
  const aligned = perChar.length === chars.length;
  const wordStartChar = new Array(chars.length).fill(true);
  if (aligned && chars.length > 0) {
    try {
      wordStartChar.fill(false);
      let pos = 0;
      for (const seg of segment(str)) {
        if (pos < wordStartChar.length) {
          wordStartChar[pos] = true;
        }
        pos += Array.from(seg.origin).length;
      }
    } catch (err) {
      wordStartChar.fill(true);
    }
  }
  const tokens = [];
  const wordStart = [];
  for (let i = 0; i < perChar.length; i += 1) {
    const tok = perChar[i];
    if (isPunctuation(tok)) {
      tokens.push(tok);
      wordStart.push(true);
      continue;
    }
    const matched = TONED_PINYIN.exec(tok);
    if (matched) {
      const tone = matched[2] === '0' ? '5' : matched[2];
      tokens.push(matched[1].toLowerCase() + tone);
      wordStart.push(Boolean(wordStartChar[i]));
    }
    // 其它字符(拉丁字母、阿拉伯数字、空格、符号)不发音,跳过。
  }
  return { tokens, wordStart };
}
//// /把任意中文文本转成 { tokens, wordStart } ////

//// 把任意中文文本转成拼音与标点 token 序列(丢词边界,仅取 token) [@busybee 2026-06-15] ////
function textToPinyinTokens(text) {
  return textToTokens(text).tokens;
}
//// /把任意中文文本转成拼音与标点 token 序列 ////

//// 把任意中文文本直接转成带重音片假名与声调计划,按词边界切子短语,供后端取 audio_query 合成 [@busybee 2026-06-15] ////
function textToAccentKana(text, options = {}) {
  const { tokens, wordStart } = textToTokens(text);
  return sentenceToAccentKana(tokens, { ...options, wordStart });
}
//// /把任意中文文本直接转成带重音片假名与声调计划 ////

module.exports = { textToTokens, textToPinyinTokens, textToAccentKana };
