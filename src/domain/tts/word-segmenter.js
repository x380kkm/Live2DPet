// audience: internal
// # word-segmenter
// 中文分词:把一句中文切成词单元与标点单元,供韵律分句(predictProsodicBreaks)用真词边界定停顿。
// 用 @node-rs/jieba 词典分词,比 pinyin-pro 的 segment 对文学与专名文本好得多(罗生门、触目惊心整体保留)。
// 不变量:第三方分词器只在本文件出现;jieba 词典只加载一次;parseMerges 与 applyMerges 是纯函数、无副作用,供 LLM 纠错用。

const { Jieba } = require('@node-rs/jieba');
const { dict } = require('@node-rs/jieba/dict.js');

const HAN = /[一-鿿]/;
const PUNCT = /[，,。.、！!？?；;：:（）()【】「」『』]/;

let jiebaInstance = null;
//// 取单例 jieba(首次加载默认词典),避免每句重复加载 [@x380kkm 2026-06-17] ////
function getJieba() {
  if (!jiebaInstance) jiebaInstance = Jieba.withDict(dict);
  return jiebaInstance;
}

//// 把一句中文切成有序的词单元 { word, sylls } 与标点单元 { punct } [@x380kkm 2026-06-17] ////
// 词单元音节数按汉字个数计;标点逐字符单列(驱动停顿);非汉字非标点(空格、字母)跳过。
function segmentWords(text) {
  const units = [];
  for (const piece of getJieba().cut(String(text || ''))) {
    if (PUNCT.test(piece)) {
      for (const ch of piece) if (PUNCT.test(ch)) units.push({ punct: ch });
      continue;
    }
    const sylls = Array.from(piece).filter((c) => HAN.test(c)).length;
    if (sylls > 0) units.push({ word: piece, sylls });
  }
  return units;
}
//// /把一句中文切成词单元与标点单元 ////

//// 从 LLM 纠错回应里解析出要合并的相邻词下标区间 [@x380kkm 2026-06-17] ////
// 回应形如 {"merges":[[2,3],[5,7]]}:每对是词单元数组里要并成一个词的起止下标(含两端)。容错:取第一段 JSON,解析失败回空数组。
function parseMerges(text) {
  const str = String(text || '');
  const match = str.match(/\{[\s\S]*\}/);
  if (!match) return [];
  try {
    const obj = JSON.parse(match[0]);
    const merges = Array.isArray(obj.merges) ? obj.merges : [];
    return merges
      .filter((m) => Array.isArray(m) && m.length === 2 && Number.isInteger(m[0]) && Number.isInteger(m[1]) && m[1] > m[0])
      .map((m) => [m[0], m[1]]);
  } catch (err) {
    return [];
  }
}
//// /从 LLM 纠错回应里解析出要合并的相邻词下标区间 ////

//// 按合并区间把相邻词单元并成一个词(音节数相加),标点单元不参与;越界或重叠的区间跳过 [@x380kkm 2026-06-17] ////
function applyMerges(units, merges) {
  if (!merges || !merges.length) return units.slice();
  // 标记每个下标是否被某个合并区间覆盖;按区间起点排序、跳过与已用区间重叠的。
  const used = new Array(units.length).fill(false);
  const valid = [];
  for (const [a, b] of [...merges].sort((x, y) => x[0] - y[0])) {
    if (a < 0 || b >= units.length) continue;
    let clash = false;
    for (let i = a; i <= b; i += 1) if (used[i] || units[i].punct != null) { clash = true; break; }
    if (clash) continue;
    for (let i = a; i <= b; i += 1) used[i] = true;
    valid.push([a, b]);
  }
  const out = [];
  let i = 0;
  while (i < units.length) {
    const range = valid.find((r) => r[0] === i);
    if (range) {
      let word = ''; let sylls = 0;
      for (let k = range[0]; k <= range[1]; k += 1) { word += units[k].word; sylls += units[k].sylls; }
      out.push({ word, sylls });
      i = range[1] + 1;
    } else {
      out.push(units[i]);
      i += 1;
    }
  }
  return out;
}
//// /按合并区间把相邻词单元并成一个词 ////

module.exports = { segmentWords, parseMerges, applyMerges };
