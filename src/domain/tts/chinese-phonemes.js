// audience: internal
// # chinese-phonemes
// 中文语音的凑音素层:把拼音(带声调数字)拆成声母、韵母、声调,用最接近的日文片假名拼出近似音节,
// 并据四声把音节内各 mora 的音高改成对应调型。VOICEVOX 是日语模型,中文靠这层近似,听感靠耳朵迭代收敛。
// 不变量:纯逻辑无副作用;声母拼到韵母首元音上;未知韵母跳过不抛;音高按 query 自身均值相对调整,适配不同声线。

// 声母与五元音(a/i/u/e/o)的片假名拼法:日语缺的音用最近的近似(l 用 ラ行、retroflex 用 ジ/チ/シ、ü 后述)。
const INITIAL_CV = {
  '': { a: 'ア', i: 'イ', u: 'ウ', e: 'エ', o: 'オ' },
  b: { a: 'バ', i: 'ビ', u: 'ブ', e: 'ベ', o: 'ボ' },
  p: { a: 'パ', i: 'ピ', u: 'プ', e: 'ペ', o: 'ポ' },
  m: { a: 'マ', i: 'ミ', u: 'ム', e: 'メ', o: 'モ' },
  f: { a: 'ファ', i: 'フィ', u: 'フ', e: 'フェ', o: 'フォ' },
  d: { a: 'ダ', i: 'ディ', u: 'ドゥ', e: 'デ', o: 'ド' },
  t: { a: 'タ', i: 'ティ', u: 'トゥ', e: 'テ', o: 'ト' },
  n: { a: 'ナ', i: 'ニ', u: 'ヌ', e: 'ネ', o: 'ノ' },
  l: { a: 'ラ', i: 'リ', u: 'ル', e: 'レ', o: 'ロ' },
  g: { a: 'ガ', i: 'ギ', u: 'グ', e: 'ゲ', o: 'ゴ' },
  k: { a: 'カ', i: 'キ', u: 'ク', e: 'ケ', o: 'コ' },
  h: { a: 'ハ', i: 'ヒ', u: 'フ', e: 'ヘ', o: 'ホ' },
  j: { a: 'ジャ', i: 'ジ', u: 'ジュ', e: 'ジェ', o: 'ジョ' },
  q: { a: 'チャ', i: 'チ', u: 'チュ', e: 'チェ', o: 'チョ' },
  x: { a: 'シャ', i: 'シ', u: 'シュ', e: 'シェ', o: 'ショ' },
  zh: { a: 'ジャ', i: 'ジ', u: 'ジュ', e: 'ジェ', o: 'ジョ' },
  ch: { a: 'チャ', i: 'チ', u: 'チュ', e: 'チェ', o: 'チョ' },
  sh: { a: 'シャ', i: 'シ', u: 'シュ', e: 'シェ', o: 'ショ' },
  r: { a: 'ラ', i: 'リ', u: 'ル', e: 'レ', o: 'ロ' },
  z: { a: 'ザ', i: 'ズ', u: 'ズ', e: 'ゼ', o: 'ゾ' },
  c: { a: 'ツァ', i: 'ツ', u: 'ツ', e: 'ツェ', o: 'ツォ' },
  s: { a: 'サ', i: 'ス', u: 'ス', e: 'セ', o: 'ソ' },
  y: { a: 'ヤ', i: 'イ', u: 'ユ', e: 'イェ', o: 'ヨ' },
  w: { a: 'ワ', i: 'ウィ', u: 'ウ', e: 'ウェ', o: 'ウォ' }
};

// 韵母的零声母片假名:首字符是声母要拼上去的基元音(ア/イ/ウ/エ/オ),其后是介音、韵尾。
const FINAL_KANA = {
  a: 'ア', o: 'オ', e: 'ウ', ê: 'エ',
  ai: 'アイ', ei: 'エイ', ao: 'アオ', ou: 'オウ',
  an: 'アン', en: 'エン', ang: 'アン', eng: 'エン', ong: 'オン',
  er: 'アル',
  i: 'イ', ia: 'イア', ie: 'イエ', iao: 'イアオ', iu: 'イウ', iou: 'イウ',
  ian: 'イェン', in: 'イン', iang: 'イアン', ing: 'イン', iong: 'イオン',
  u: 'ウ', ua: 'ウア', uo: 'ウオ', uai: 'ウアイ', ui: 'ウイ', uei: 'ウイ',
  uan: 'ウアン', un: 'ウン', uen: 'ウン', uang: 'ウアン', ueng: 'ウオン',
  ü: 'ユ', v: 'ユ', üe: 'ユエ', ve: 'ユエ', üan: 'ユエン', van: 'ユエン', ün: 'ユン', vn: 'ユン'
};

// 基元音片假名到元音字母,供声母按韵母首元音选拼法。
const BASE_VOWEL = { ア: 'a', イ: 'i', ウ: 'u', エ: 'e', オ: 'o' };
// 与前一基音合成一个 mora 的小书写假名,数 mora 时跳过。
const COMBINING = new Set(['ァ', 'ィ', 'ゥ', 'ェ', 'ォ', 'ャ', 'ュ', 'ョ']);
// 单元音韵母:中文这些音比日语 mora 长而平,补长音ー拉成两拍,既更像中文也给升降调留出展开空间(轻声不拉)。
const ELONGATE_FINALS = new Set(['a', 'o', 'e', 'ê', 'i', 'u', 'ü', 'v']);
// 声母按长到短匹配,zh/ch/sh 优先于单字母。
const INITIALS = ['zh', 'ch', 'sh', 'b', 'p', 'm', 'f', 'd', 't', 'n', 'l', 'g', 'k', 'h', 'j', 'q', 'x', 'r', 'z', 'c', 's', 'y', 'w'];

//// 数片假名的 mora 数:小书写假名并入前一个,其余各计一个 [@busybee 2026-06-15] ////
function moraCount(kana) {
  let count = 0;
  for (const ch of kana) {
    if (!COMBINING.has(ch)) {
      count += 1;
    }
  }
  return count;
}
//// /数片假名的 mora 数 ////

//// 把一个带声调数字的拼音音节拆成声母、韵母、声调 [@busybee 2026-06-15] ////
// 末尾 1 到 5 为声调,无则记轻声 5;j/q/x/y 后的 u 实为 ü。
function parsePinyin(raw) {
  const text = String(raw || '').trim().toLowerCase();
  const toneMatch = text.match(/([1-5])$/);
  const tone = toneMatch ? parseInt(toneMatch[1], 10) : 5;
  const body = text.replace(/[1-5]$/, '');
  let initial = '';
  for (const candidate of INITIALS) {
    if (body.startsWith(candidate)) {
      initial = candidate;
      break;
    }
  }
  let final = body.slice(initial.length);
  if (['j', 'q', 'x', 'y'].includes(initial) && final.startsWith('u')) {
    final = 'ü' + final.slice(1);
  }
  return { initial, final, tone, body };
}
//// /把一个拼音音节拆成声母、韵母、声调 ////

//// 把声母拼到韵母首元音上:取首基元音定列,换成声母加该元音的拼法 [@busybee 2026-06-15] ////
function applyInitial(initial, finalKana) {
  const vowel = BASE_VOWEL[finalKana[0]];
  if (!vowel) {
    return finalKana;
  }
  const table = INITIAL_CV[initial] || INITIAL_CV[''];
  const cv = table[vowel] || finalKana[0];
  return cv + finalKana.slice(1);
}
//// /把声母拼到韵母首元音上 ////

//// 把一个拼音音节拼成片假名,单元音韵母补长音ー,回 { kana, moras, ok } [@busybee 2026-06-15] ////
// 长音让中文单元音持续得更像中文,也把单拍音节拉成两拍,使升降调能在音节内展开;轻声不拉。
function syllableToKana(parsed) {
  const finalKana = FINAL_KANA[parsed.final];
  if (!finalKana) {
    return { kana: '', moras: 0, ok: false };
  }
  let kana = applyInitial(parsed.initial, finalKana);
  if (ELONGATE_FINALS.has(parsed.final) && parsed.tone !== 5) {
    kana += 'ー';
  }
  return { kana, moras: moraCount(kana), ok: true };
}
//// /把一个拼音音节拼成片假名 ////

//// 判断一个 token 是不是标点,中英逗号句号都算 [@busybee 2026-06-15] ////
function isPunctuation(token) {
  return /^[，,。.、!?！？；;：:]+$/.test(token);
}

//// 把一串拼音与标点 token 拼成片假名串与声调计划 [@busybee 2026-06-15] ////
// 先按三声变调改声调(相邻两个三声,前一个读二声;标点断开不变调),再据变调后的声调拼假名(含长音)与计划。
function sentenceToKana(tokens) {
  const items = tokens.map((token) => (isPunctuation(token) ? { punct: token } : { parsed: parsePinyin(token) }));
  applyToneSandhi(items);

  let kana = '';
  const plan = [];
  for (const item of items) {
    if (item.punct) {
      kana += /[。.！？!?]/.test(item.punct) ? '。' : '、';
      continue;
    }
    const syllable = syllableToKana(item.parsed);
    if (!syllable.ok || syllable.moras === 0) {
      continue;
    }
    kana += syllable.kana;
    plan.push({ kana: syllable.kana, moras: syllable.moras, tone: item.parsed.tone });
  }
  return { kana, plan };
}
//// /把一串拼音与标点 token 拼成片假名串与声调计划 ////

//// 三声变调:相邻两个三声里前一个改读二声,标点断开则重置不跨标点变调 [@busybee 2026-06-15] ////
function applyToneSandhi(items) {
  let prev = null;
  for (const item of items) {
    if (item.punct) {
      prev = null;
      continue;
    }
    if (prev && prev.tone === 3 && item.parsed.tone === 3) {
      prev.tone = 2;
    }
    prev = item.parsed;
  }
}
//// /三声变调 ////

//// 把一个停顿组内的多个 accent_phrase 合并成一个,消除词间停顿与音高重置,让连读不打断 [@busybee 2026-06-15] ////
// VOICEVOX 把片假名按词切成多个 accent_phrase,词界会插微停顿并重置音高,中文听起来一顿一顿;
// 这里把相邻、其间没有停顿 mora 的 phrase 并成一个,只在标点的停顿处断开,合成出来就连贯。
function flowPhrases(query) {
  const phrases = (query && query.accent_phrases) || [];
  const merged = [];
  for (const phrase of phrases) {
    const last = merged[merged.length - 1];
    if (last && !last.pause_mora) {
      last.moras = last.moras.concat(phrase.moras || []);
      last.pause_mora = phrase.pause_mora || null;
      last.is_interrogative = last.is_interrogative || Boolean(phrase.is_interrogative);
    } else {
      merged.push({
        moras: (phrase.moras || []).slice(),
        accent: phrase.accent || 1,
        pause_mora: phrase.pause_mora || null,
        is_interrogative: Boolean(phrase.is_interrogative)
      });
    }
  }
  query.accent_phrases = merged;
  return query;
}
//// /把一个停顿组内的多个 accent_phrase 合并成一个 ////

//// 把各 mora 的时长拉成中文那种持续、连贯的样子:抻长元音、压短辅音、收紧停顿 [@busybee 2026-06-15] ////
// 日语 mora 短促,逐拍听起来一顿一顿;中文音节更长更连。抻长元音让音持续、声调滑得开,压短辅音减少音节间空隙,
// 标点停顿收到适中长度。config 可调 vowelFloor/vowelScale/consonantCap/pauseCap。
function shapeFlow(query, config = {}) {
  const vowelFloor = config.vowelFloor != null ? config.vowelFloor : 0.16;
  const vowelScale = config.vowelScale != null ? config.vowelScale : 1.5;
  const consonantCap = config.consonantCap != null ? config.consonantCap : 0.05;
  const pauseCap = config.pauseCap != null ? config.pauseCap : 0.22;
  for (const phrase of (query.accent_phrases || [])) {
    for (const mora of (phrase.moras || [])) {
      if (mora.vowel_length != null && mora.vowel_length > 0) {
        mora.vowel_length = Math.max(vowelFloor, mora.vowel_length * vowelScale);
      }
      if (mora.consonant_length != null) {
        mora.consonant_length = Math.min(mora.consonant_length, consonantCap);
      }
    }
    if (phrase.pause_mora && phrase.pause_mora.vowel_length != null) {
      phrase.pause_mora.vowel_length = Math.min(phrase.pause_mora.vowel_length, pauseCap);
    }
  }
  return query;
}
//// /把各 mora 的时长拉成中文那种持续、连贯的样子 ////

//// 据声调与音节 mora 数算各 mora 的目标音高,相对基准音高 [@busybee 2026-06-15] ////
// 一声高平、二声上升、三声压低微升、四声下降、轻声略低;单 mora 取代表值(调内走势靠相邻音节体现)。
function toneContour(tone, moras, base) {
  const out = [];
  const fill = (value) => { for (let i = 0; i < moras; i++) out.push(value); };
  const ramp = (lo, hi) => {
    for (let i = 0; i < moras; i++) {
      out.push(moras === 1 ? hi : lo + (hi - lo) * (i / (moras - 1)));
    }
  };
  if (tone === 1) {
    fill(base + 0.30);
  } else if (tone === 2) {
    ramp(base - 0.05, base + 0.30);
  } else if (tone === 3) {
    if (moras === 1) {
      fill(base - 0.40);
    } else {
      // 低降到谷底再略升:三声的特征是压低,升尾很弱
      const valley = Math.max(1, Math.floor(moras * 0.6));
      for (let i = 0; i < moras; i += 1) {
        if (i < valley) {
          out.push(base - 0.45 - 0.10 * (i / valley));
        } else {
          out.push(base - 0.45 + 0.30 * ((i - valley) / Math.max(1, moras - valley)));
        }
      }
    }
  } else if (tone === 4) {
    if (moras === 1) {
      fill(base + 0.32);
    } else {
      ramp(base + 0.42, base - 0.30);
    }
  } else {
    fill(base - 0.05);
  }
  return out.map((pitch) => Math.max(4.8, Math.min(6.6, pitch)));
}
//// /据声调与音节 mora 数算各 mora 的目标音高 ////

//// 按声调计划把 query 各 mora 的音高改成对应调型,音高以 query 自身均值为基准 [@busybee 2026-06-15] ////
// 把全句 mora 铺平;按计划逐音节吞 mora,直到吞下的 mora 文本覆盖该音节的片假名,据实际吞到的 mora 数算调型,
// 这样不依赖事先预测的 mora 数,引擎把 ドゥ 这类拆成两拍也能对齐。只改有声 mora 的音高。
function applyTones(query, plan) {
  const moras = [];
  for (const phrase of (query.accent_phrases || [])) {
    for (const mora of (phrase.moras || [])) {
      moras.push(mora);
    }
  }
  const voiced = moras.filter((mora) => mora.pitch > 0);
  const base = voiced.length ? voiced.reduce((sum, mora) => sum + mora.pitch, 0) / voiced.length : 5.8;

  let index = 0;
  for (const syllable of plan) {
    const target = (syllable.kana || '').length;
    const group = [];
    let covered = 0;
    while (index < moras.length && covered < target) {
      const mora = moras[index];
      index += 1;
      covered += (mora.text || '').length || 1;
      group.push(mora);
    }
    const contour = toneContour(syllable.tone, group.length, base);
    for (let i = 0; i < group.length; i += 1) {
      if (group[i].pitch > 0 && contour[i] !== undefined) {
        group[i].pitch = contour[i];
      }
    }
  }
  return query;
}
//// /按声调计划把 query 各 mora 的音高改成对应调型 ////

module.exports = {
  parsePinyin,
  syllableToKana,
  sentenceToKana,
  toneContour,
  applyTones,
  flowPhrases,
  shapeFlow,
  moraCount,
  INITIAL_CV,
  FINAL_KANA
};
