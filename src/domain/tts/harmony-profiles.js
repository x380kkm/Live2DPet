// audience: internal
// # harmony-profiles
// 各风格各用一套和声语汇,解决「不同风格的和弦进行雷同」:之前所有大调风格共用同一张和弦转移表,同种子下进行字字相同。
// 一张和声档 = { mode 大小调, source 来源, chordStart 起始和弦分布, chordTrans 和弦级序号的一阶转移, holdProb 保持上一和弦的概率(和声节奏:越大换得越慢、越像持续/踏板), chordDur? 学到的和声节奏 }。
// 来源分两类:corpus 从真实语料学(动漫取自 AnimeTAB 吉他谱 chordify、民谣取自 Nottingham ABC 和弦标注);characteristic 是按风格惯用进行手写的占位档(电子/音乐剧/kpop/儿歌暂无对应日语符号和弦语料),找到语料后替换。
// 和弦级序号:大调 0=I 1=ii 2=iii 3=IV 4=V 5=vi 6=vii;小调 0=i 1=ii° 2=III 3=iv 4=v 5=VI 6=VII。composer 的 triad(序号) 同坐标系。

const fs = require('fs');
const path = require('path');

//// 从训练好的模型 JSON 取和声字段 [@x380kkm 2026-06-21] ////
function loadFrom(file, mode, holdProb) {
  const j = JSON.parse(fs.readFileSync(path.join(__dirname, file), 'utf8'));
  return { mode, source: 'corpus', chordStart: j.chordStart, chordTrans: j.chordTrans, chordDur: j.chordDur, holdProb };
}
//// /取和声字段 ////

// 语料学来的和声:动漫来自旋律模型里嫁接的 AnimeTAB chordify,民谣来自 Nottingham。
const CORPUS = {
  'anime-major': () => loadFrom('melody-model-anime-major.json', 'major', 0.1),
  'anime-minor': () => loadFrom('melody-model-anime-minor.json', 'minor', 0.1),
  'folk-major': () => loadFrom('chord-model-folk-major.json', 'major', 0.15),
  'folk-minor': () => loadFrom('chord-model-folk-minor.json', 'minor', 0.15),
};

// 手写占位的特征和声:按各风格惯用进行设,刻意彼此区分;holdProb 体现和声节奏(电子慢、音乐剧快)。
const CHARACTERISTIC = {
  // kpop 流行环:vi-IV-I-V 循环。
  kpop: {
    mode: 'major', source: 'characteristic', holdProb: 0.1,
    chordStart: { 5: 3, 0: 1 },
    chordTrans: { 0: { 4: 3, 5: 1 }, 1: { 4: 2, 3: 1 }, 2: { 5: 1 }, 3: { 0: 3, 4: 2 }, 4: { 5: 3, 0: 2 }, 5: { 3: 4, 1: 1 }, 6: { 0: 1 } },
  },
  // 硬核电子(大调):模态、极简、持续低音感;和弦少、换得慢(holdProb 高),给推进的踏板底色。
  'hard-electronic-major': {
    mode: 'major', source: 'characteristic', holdProb: 0.45,
    chordStart: { 5: 2, 0: 2, 3: 1 },
    chordTrans: { 0: { 4: 2, 5: 2 }, 1: { 4: 1 }, 2: { 5: 1 }, 3: { 0: 2, 4: 1, 5: 1 }, 4: { 0: 2, 5: 1 }, 5: { 3: 3, 4: 1 }, 6: { 0: 1 } },
  },
  // 硬核电子(小调,dnb):i-VI-VII、i-VII 模态暗色;同样换得慢。
  'hard-electronic-minor': {
    mode: 'minor', source: 'characteristic', holdProb: 0.4,
    chordStart: { 0: 3, 5: 1 },
    chordTrans: { 0: { 5: 2, 6: 2, 3: 1 }, 1: { 4: 1, 0: 1 }, 2: { 5: 1, 6: 1 }, 3: { 0: 1, 4: 1, 5: 1 }, 4: { 0: 2, 5: 1 }, 5: { 6: 2, 3: 1, 0: 1 }, 6: { 0: 2, 5: 1, 2: 1 } },
  },
  // 音乐剧:和声丰富、走动多(holdProb 低),含二级、副属感、借用色彩。
  musical: {
    mode: 'major', source: 'characteristic', holdProb: 0.05,
    chordStart: { 0: 3, 5: 1, 3: 1 },
    chordTrans: { 0: { 3: 2, 5: 2, 1: 2, 2: 1, 4: 1 }, 1: { 4: 3, 2: 1 }, 2: { 5: 2, 3: 1, 1: 1 }, 3: { 4: 2, 1: 1, 0: 1, 2: 1 }, 4: { 0: 3, 5: 1, 2: 1 }, 5: { 1: 2, 3: 1, 2: 1, 4: 1 }, 6: { 0: 2, 2: 1 } },
  },
  // 儿歌:I-IV-V-vi 极简明亮,换得稍慢。
  children: {
    mode: 'major', source: 'characteristic', holdProb: 0.2,
    chordStart: { 0: 4 },
    chordTrans: { 0: { 3: 2, 4: 2, 5: 1 }, 1: { 4: 1 }, 2: { 5: 1 }, 3: { 0: 2, 4: 2 }, 4: { 0: 3, 5: 1 }, 5: { 3: 1, 4: 1, 0: 1 }, 6: { 0: 1 } },
  },
};

//// 按名取一套和声档:语料档惰性读盘并缓存,特征档直接返回 [@x380kkm 2026-06-21] ////
const cache = {};
function getHarmony(name) {
  if (!name) return null;
  if (CHARACTERISTIC[name]) return CHARACTERISTIC[name];
  if (CORPUS[name]) {
    if (!cache[name]) cache[name] = CORPUS[name]();
    return cache[name];
  }
  throw new Error(`未知和声档:${name}`);
}
//// /按名取和声档 ////

module.exports = { getHarmony };
