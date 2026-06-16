// audience: internal
// # chinese-text
// 把任意中文文本转成带声调拼音 token 序列(并标出词边界),交 chinese-phonemes 的 sentenceToAccentKana 拼日文音素合成。
// 汉字转拼音用 pinyin-pro,自带按词消歧的多音字处理(银行 hang、行走 xing、重要 zhong、重复 chong);它的逐字符分词给词边界,供凑音素层按词切子短语、不从词中间断开。
// 句内停顿默认走确定性韵律分句:autoMarkPhrasing 用 word-segmenter(jieba 词典分词,专名成语整体保留)加 predictProsodicBreaks 自动插「/」半停,替掉大模型凭感觉标的记号;文本已带「/」则尊重原标记。
// 标点保留(在凑音素层驱动全停),拉丁字母、数字等不发音的字符跳过。
// 不变量:第三方 pinyin-pro 只在本文件出现、jieba 只在 word-segmenter 出现;轻声记声调 5;除 autoMarkPhrasing 经 jieba 单例外纯函数无副作用。

const { pinyin, segment } = require('pinyin-pro');
const { isPunctuation, sentenceToAccentKana } = require('./chinese-phonemes');
const { segmentWords } = require('./word-segmenter');

// 一个 token 是不是汉字转出的带声调拼音:字母串后必带一位声调数字(0 到 5),据此与残留的拉丁字母、符号区分。
const TONED_PINYIN = /^([a-zü]+)([0-5])$/i;

//// 把任意中文文本转成 { tokens, wordStart }:拼音与标点 token,以及每个 token 是否为一个词的开头 [@x380kkm 2026-06-15] ////
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
    // 斜杠是 LLM 在自然短语边界插入的断句记号,保留下来在凑音素层驱动句内半半停顿(展示气泡前由上层去掉)。
    if (tok === '/') {
      tokens.push('/');
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

//// 把任意中文文本转成拼音与标点 token 序列(丢词边界,仅取 token) [@x380kkm 2026-06-15] ////
function textToPinyinTokens(text) {
  return textToTokens(text).tokens;
}
//// /把任意中文文本转成拼音与标点 token 序列 ////

// 特指问的疑问词:含其一即判为特指问(走陈述句的下降,不套用是非问的句末上扬)。
const WH_WORDS = ['为什么', '为何', '怎么', '怎样', '什么', '哪儿', '哪里', '哪', '谁', '多少', '几', '啥'];

//// 据疑问词与句末标点判句类型:感叹、特指问、是非问、陈述 [@x380kkm 2026-06-16] ////
// 分词对生僻词不可靠,这里只用疑问词表与标点这类稳的线索。有疑问词→特指问(走下降);否则有问号或句末是非问语气词(吗/吧/呢)→是非问(句末上扬);叹号→感叹;其余→陈述。
function classifySentenceType(text) {
  const s = String(text || '');
  if (/[！!]/.test(s)) return 'exclamation';
  if (WH_WORDS.some((w) => s.includes(w))) return 'whQuestion';
  if (/[？?]/.test(s) || /[吗呢吧][。.！!？?」』"'）)\s]*$/.test(s)) return 'ynQuestion';
  return 'statement';
}
//// /据疑问词与句末标点判句类型 ////

//// 用 jieba 分词与确定性韵律分句,在韵律短语边界自动插「/」,替掉大模型凭感觉标的记号 [@x380kkm 2026-06-17] ////
// jieba 词典分词把专名成语整体保留(罗生门、触目惊心),predictProsodicBreaks 据真词边界与音节数定韵律短语停顿;标点的全停由标点本身驱动,故只补 `/` 半停。
function autoMarkPhrasing(text) {
  const units = segmentWords(text);
  const breaks = predictProsodicBreaks(units);
  let out = '';
  for (let i = 0; i < units.length; i += 1) {
    out += units[i].punct != null ? units[i].punct : units[i].word;
    if (breaks[i] === 'PPh') out += '/';
  }
  return out;
}
//// /用 jieba 分词与确定性韵律分句自动插「/」 ////

//// 把任意中文文本直接转成带重音片假名与声调计划,按词边界切子短语,供后端取 audio_query 合成 [@x380kkm 2026-06-15] ////
// 默认开三声连读变调:两个三声相连,前一个变二声(你好念 ní hǎo)。pinyin-pro 已处理一、不的变调,这里只补三声。
// 句内停顿默认走确定性韵律分句(autoMarkPhrasing 自动插 `/`);文本已带 `/`(上游覆盖)则尊重原标记、不再自动插;显式传 options.autoPhrasing 为 false 也跳过。
// 句类型默认按文本自动判,显式传 options.sentenceType 可覆盖(供试听对比不同句调)。
function textToAccentKana(text, options = {}) {
  const auto = options.autoPhrasing !== false && !String(text || '').includes('/');
  const phrased = auto ? autoMarkPhrasing(text) : text;
  const { tokens, wordStart } = textToTokens(phrased);
  const sandhi = options.sandhi != null ? options.sandhi : true;
  const sentenceType = options.sentenceType || classifySentenceType(text);
  return sentenceToAccentKana(tokens, { ...options, wordStart, sandhi, sentenceType });
}
//// /把任意中文文本直接转成带重音片假名与声调计划 ////

// 后附虚词(轻声助词、语气词):它们贴着前一个字念、其前不断,合进左侧韵律词。
const PROSODY_ENCLITIC = new Set(['的', '地', '得', '了', '着', '过', '们', '吗', '呢', '吧', '啊', '呀', '嘛', '啦']);
// 领头虚词(介词、连词):语义上领起后文,不在它前后单独制造停顿,把成组交给音节数与标点决定。
const PROSODY_LEADING = new Set(['把', '被', '在', '向', '对', '从', '给', '跟', '和', '与', '及', '或', '而']);
// 韵律短语目标音节数与上限:依据归档蓝图(Lai 2016 实测短语峰在 2 到 4、范围到 5;Hong 1999 两停顿间均约 3.6 音节)。
const PPH_TARGET = 3; const PPH_SOFTMAX = 4; const PPH_HARDMAX = 5;
// 韵律词最长音节数:标准音步两音节,右端允许扩到三(冯胜利右向音步)。单音节连读到此上限即另起,免得分词把整句切成单字时全黏成一个超长韵律词、按长度切短语失效。
const PW_MAX = 3;

//// 在一个语调短语块(标点之间的若干词)内,先并韵律词、再按累计音节数软切韵律短语,写回每个词后的边界层级 [@x380kkm 2026-06-17] ////
function phraseProsodicBlock(positions, units, breaks) {
  // 第二步:并韵律词。单音节词与后附虚词合进左侧;领头虚词自成一组、且其前后不切。多音节词起新组。
  const groups = [];
  const leadingBoundary = new Set(); // 不可升为韵律短语停顿的组边界(领头虚词两侧)
  for (let k = 0; k < positions.length; k += 1) {
    const u = units[positions[k]];
    const isLeading = u.word && u.word.length === 1 && PROSODY_LEADING.has(u.word);
    const isEnclitic = u.word && u.word.length === 1 && PROSODY_ENCLITIC.has(u.word);
    const monosyllable = (u.sylls || 1) === 1;
    // 后附虚词无条件并左;普通单音节只在左侧韵律词还没满(< PW_MAX)时并左,满了就另起,免得长串单字黏成一个超长词。
    const last = groups[groups.length - 1];
    const gluesLeft = groups.length > 0 && !isLeading && (isEnclitic || (monosyllable && last.sylls < PW_MAX));
    if (gluesLeft) {
      groups[groups.length - 1].positions.push(k);
      groups[groups.length - 1].sylls += (u.sylls || 1);
      breaks[positions[k - 1]] = 'PW'; // 与前一字连读,内部不停
    } else {
      groups.push({ positions: [k], sylls: u.sylls || 1 });
    }
    if (isLeading) { leadingBoundary.add(groups.length - 1); leadingBoundary.add(groups.length - 2); }
  }
  // 第三步:在韵律词序列上按累计音节数软切韵律短语。组内连读,组间到长度阈值处断。
  let acc = 0;
  for (let g = 0; g < groups.length; g += 1) {
    acc += groups[g].sylls;
    const last = g === groups.length - 1;
    if (last) break; // 块末由标点(IP)收尾,不在此加韵律短语停顿
    const nextSyl = groups[g + 1].sylls;
    const shouldBreak = acc >= PPH_HARDMAX || (acc >= PPH_TARGET && acc + nextSyl > PPH_SOFTMAX);
    const suppressed = leadingBoundary.has(g);
    if (shouldBreak && !suppressed) {
      const lastPosInGroup = groups[g].positions[groups[g].positions.length - 1];
      breaks[positions[lastPosInGroup]] = 'PPh';
      acc = 0;
    }
  }
}
//// /在一个语调短语块内并韵律词、软切韵律短语 ////

//// 从词单元与标点确定性预测每个单元后的韵律边界层级(none/PW/PPh/IP),替掉大模型凭感觉插的 / 记号 [@x380kkm 2026-06-17] ////
// units 是 { word, sylls } 词单元与 { punct } 标点单元的有序数组。三级:PW 韵律词内连读不停、PPh 韵律短语半停、IP 语调短语全停。
// 算法:标点定 IP(顿号降为 PPh),把序列切成语调短语块;块内并韵律词、再按音节数软切 PPh。依据归档蓝图,经对抗式核验;参数为工程取值,需试听校准。
function predictProsodicBreaks(units) {
  const breaks = new Array(units.length).fill('none');
  let block = [];
  const flush = () => { if (block.length) phraseProsodicBlock(block, units, breaks); block = []; };
  for (let i = 0; i < units.length; i += 1) {
    const u = units[i];
    if (u.punct != null) {
      flush();
      breaks[i] = u.punct === '、' ? 'PPh' : 'IP';
    } else {
      block.push(i);
    }
  }
  flush();
  return breaks;
}
//// /从词单元与标点确定性预测韵律边界层级 ////

module.exports = { textToTokens, textToPinyinTokens, textToAccentKana, classifySentenceType, predictProsodicBreaks, autoMarkPhrasing };
