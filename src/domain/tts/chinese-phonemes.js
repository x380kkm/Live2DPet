// audience: internal
// # chinese-phonemes
// 中文语音的凑音素层:把拼音(带声调数字)拆成声母、韵母、声调,用最接近的日文片假名拼出近似音节,
// 并据四声把音节内各 mora 的音高改成对应调型。VOICEVOX 是日语模型,中文靠这层近似,听感靠耳朵迭代收敛。
// 不变量:纯逻辑无副作用;声母拼到韵母首元音上;未知韵母跳过不抛;音高按 query 自身均值相对调整,适配不同声线。

// 声母与五元音(a/i/u/e/o)的片假名拼法:日语缺的音用最近的近似(l 用 ラ行、retroflex 用 ジ/チ/シ、ü 后述)。
const INITIAL_CV = {
  '': { a: 'ア', i: 'イ', u: 'ウ', e: 'エ', o: 'オ', v: 'ユ' },
  b: { a: 'バ', i: 'ビ', u: 'ブ', e: 'ベ', o: 'ボ' },
  p: { a: 'パ', i: 'ピ', u: 'プ', e: 'ペ', o: 'ポ' },
  m: { a: 'マ', i: 'ミ', u: 'ム', e: 'メ', o: 'モ' },
  f: { a: 'ファ', i: 'フィ', u: 'フ', e: 'フェ', o: 'フォ' },
  d: { a: 'ダ', i: 'ディ', u: 'ドゥ', e: 'デ', o: 'ド' },
  t: { a: 'タ', i: 'ティ', u: 'トゥ', e: 'テ', o: 'ト' },
  n: { a: 'ナ', i: 'ニ', u: 'ヌ', e: 'ネ', o: 'ノ', v: 'ニュ' },
  l: { a: 'ラ', i: 'リ', u: 'ル', e: 'レ', o: 'ロ', v: 'リュ' },
  g: { a: 'ガ', i: 'ギ', u: 'グ', e: 'ゲ', o: 'ゴ' },
  k: { a: 'カ', i: 'キ', u: 'ク', e: 'ケ', o: 'コ' },
  h: { a: 'ハ', i: 'ヒ', u: 'フ', e: 'ヘ', o: 'ホ' },
  j: { a: 'ジャ', i: 'ジ', u: 'ジュ', e: 'ジェ', o: 'ジョ', v: 'ジュ' },
  q: { a: 'チャ', i: 'チ', u: 'チュ', e: 'チェ', o: 'チョ', v: 'チュ' },
  x: { a: 'シャ', i: 'シ', u: 'シュ', e: 'シェ', o: 'ショ', v: 'シュ' },
  zh: { a: 'ジャ', i: 'ジ', u: 'ジュ', e: 'ジェ', o: 'ジョ' },
  ch: { a: 'チャ', i: 'チ', u: 'チュ', e: 'チェ', o: 'チョ' },
  sh: { a: 'シャ', i: 'シ', u: 'シュ', e: 'シェ', o: 'ショ' },
  r: { a: 'ラ', i: 'リ', u: 'ル', e: 'レ', o: 'ロ' },
  z: { a: 'ザ', i: 'ズ', u: 'ズ', e: 'ゼ', o: 'ゾ' },
  c: { a: 'ツァ', i: 'ツ', u: 'ツ', e: 'ツェ', o: 'ツォ' },
  s: { a: 'サ', i: 'ス', u: 'ス', e: 'セ', o: 'ソ' },
  y: { a: 'ヤ', i: 'イ', u: 'ユ', e: 'イェ', o: 'ヨ', v: 'ユ' },
  w: { a: 'ワ', i: 'ウィ', u: 'ウ', e: 'ウェ', o: 'ウォ' }
};

// 韵母的零声母片假名:首字符是声母要拼上去的基元音(ア/イ/ウ/エ/オ),其后是介音、韵尾。
// 后鼻韵尾 -ng 与前鼻韵尾 -n 都收到 ン:补长音区分会把音节拖长、连读被拖累,得不偿失,宁可不分。
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
// 单元音韵母:中文这些音比日语 mora 长而平,补一拍拉成两拍,既更像中文也给升降调留出展开空间(轻声不拉)。
const ELONGATE_FINALS = new Set(['a', 'o', 'e', 'ê', 'i', 'u', 'ü', 'v']);
// 重音核路线不收长音ー,改用重复基元音补拍(ニ→ニイ);每个单元音韵母对应的补拍假名。
const ELONGATE_VOWEL = { a: 'ア', o: 'オ', e: 'ウ', ê: 'エ', i: 'イ', u: 'ウ', ü: 'ウ', v: 'ウ' };
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

//// 把声母拼到韵母首元音上:取首元音定列(ユ 为 ü 列),换成声母加该元音的拼法 [@busybee 2026-06-15] ////
function applyInitial(initial, finalKana) {
  // ü 韵母片假名以 ユ 起头,走 ü 列(v);其余按基元音 ア/イ/ウ/エ/オ 定列。
  const vowel = finalKana[0] === 'ユ' ? 'v' : BASE_VOWEL[finalKana[0]];
  if (!vowel) {
    return finalKana;
  }
  const table = INITIAL_CV[initial] || INITIAL_CV[''];
  const cv = table[vowel] || finalKana[0];
  return cv + finalKana.slice(1);
}
//// /把声母拼到韵母首元音上 ////

//// 把一个拼音音节拼成片假名,单元音韵母可补长音ー,回 { kana, moras, ok } [@busybee 2026-06-15] ////
// 长音让中文单元音持续得更像中文、把单拍拉成两拍承调;但 AquesTalk 风记法不收 ー,故重音核路线传 elongate:false 关掉。
function syllableToKana(parsed, options = {}) {
  const finalKana = FINAL_KANA[parsed.final];
  if (!finalKana) {
    return { kana: '', moras: 0, ok: false };
  }
  let kana = applyInitial(parsed.initial, finalKana);
  const elongate = options.elongate !== false;
  if (elongate && ELONGATE_FINALS.has(parsed.final) && parsed.tone !== 5) {
    // 重音核路线传 kanaSafe:不收长音ー,改用重复基元音补一拍;否则用长音ー。
    kana += options.kanaSafe ? (ELONGATE_VOWEL[parsed.final] || '') : 'ー';
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

//// 把一组元素等长切成至多 max 个一份的若干份:短于 max 不切 [@busybee 2026-06-15] ////
function chunkEvenly(items, max) {
  const total = items.length;
  if (total <= max) {
    return [items];
  }
  const count = Math.ceil(total / max);
  const size = Math.ceil(total / count);
  const out = [];
  for (let i = 0; i < total; i += size) {
    out.push(items.slice(i, i + size));
  }
  return out;
}
//// /把一组元素等长切成若干份 ////

//// 把拼音与标点拼成 AquesTalk 风格带重音的片假名与声调计划:停顿组按等长切子短语,组内 / 连读、组间 、停顿 [@busybee 2026-06-15] ////
// 先三声变调,再据声调置重音核,让引擎按重音生成自然时长;重音核路线不补长音(AquesTalk 不收 ー)。
// 返回 { kana, plan }:kana 交 audioQueryFromKana,plan 供 applyMandarinTones 在自然时长上铺四声音高。
function sentenceToAccentKana(tokens, options = {}) {
  const items = tokens.map((token) => (isPunctuation(token) ? { punct: token } : { parsed: parsePinyin(token) }));
  // 三声变调默认关:变调会把「你好」的「你」读成上扬的二声、听感像「尼」;需要时传 sandhi:true 打开。
  if (options.sandhi) {
    applyToneSandhi(items);
  }

  // 每短语最多几个音节:太长的停顿组会飘、听不清,切成等长子短语重新锚定(子短语间用 / 无停顿)。
  const maxPhrase = options.maxPhrase || 4;
  const plan = [];
  const groups = [];
  let current = [];
  for (const item of items) {
    if (item.punct) {
      if (current.length) {
        groups.push(current);
        current = [];
      }
      continue;
    }
    const syllable = syllableToKana(item.parsed, { elongate: true, kanaSafe: true });
    if (!syllable.ok || syllable.moras === 0) {
      continue;
    }
    current.push(syllable.kana);
    plan.push({ kana: syllable.kana, moras: syllable.moras, tone: item.parsed.tone, ng: NG_FINALS.has(item.parsed.final) });
  }
  if (current.length) {
    groups.push(current);
  }

  // 每个停顿组按等长切成子短语(短组不切),子短语并成一个语调短语连读、子短语间用 / 无停顿、组间用 、停顿;
  // 重音核置末仅为满足 AquesTalk 解析,实际四声听感由 applyMandarinTones 逐音节铺音高决定。
  const kana = groups.map((group) => chunkEvenly(group, maxPhrase).map((sub) => sub.join('') + "'").join('/')).join('、');
  return { kana, plan };
}
//// /把拼音与标点拼成 AquesTalk 风格带重音的片假名与声调计划 ////

//// 在每个语调短语内对有声 mora 的音高做轻量平滑,把音节间的硬跳变软成滑音,让语调连贯 [@busybee 2026-06-15] ////
// applyMandarinTones 逐音节铺的是各自独立的调值,音节交界处是台阶式硬跳;轻平滑软化交界、保留调型走势。
// 只在短语内平滑(不跨停顿),strength 为向邻拍靠拢的比例。
function smoothPitch(query, strength = 0.35) {
  for (const phrase of (query.accent_phrases || [])) {
    const voiced = (phrase.moras || []).filter((mora) => mora.pitch > 0);
    if (voiced.length < 3) {
      continue;
    }
    const original = voiced.map((mora) => mora.pitch);
    for (let i = 0; i < voiced.length; i += 1) {
      const prev = i > 0 ? original[i - 1] : original[i];
      const next = i < voiced.length - 1 ? original[i + 1] : original[i];
      voiced[i].pitch = (1 - strength) * original[i] + strength * 0.5 * (prev + next);
    }
  }
  return query;
}
//// /在每个语调短语内对音高做轻量平滑 ////

// ハ 行片假名:中文声母 h 落在这几个 mora 上。
const H_MORAS = new Set(['ハ', 'ヒ', 'フ', 'ヘ', 'ホ']);
// 后鼻韵尾 -ng 的韵母:日语 ン 不分前后鼻,把这些音节的鼻音拉长一点作后鼻的听感线索。
const NG_FINALS = new Set(['ang', 'eng', 'ing', 'ong', 'iang', 'iong', 'uang', 'ueng']);

//// 给 -ng 音节的末尾鼻音拉长一点,作前鼻 -n 与后鼻 -ng 的区分线索(日语 ン 本不分) [@busybee 2026-06-15] ////
// 据计划逐音节吞 mora 覆盖该音节片假名,-ng 音节把最后一拍(ン)的元音时长按系数拉长,鼻音更沉、更靠后。
function markNasalContrast(query, plan, ngFactor = 1.7) {
  const moras = [];
  for (const phrase of (query.accent_phrases || [])) {
    for (const mora of (phrase.moras || [])) {
      moras.push(mora);
    }
  }
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
    if (syllable.ng && group.length) {
      const last = group[group.length - 1];
      if (last.vowel_length != null) {
        last.vowel_length *= ngFactor;
      }
    }
  }
  return query;
}
//// /给 -ng 音节的末尾鼻音拉长一点 ////

//// 拉长 ハ 行辅音,逼近普通话声母 h 的较强软腭擦音(日语只有更轻的 h,长一点更像) [@busybee 2026-06-15] ////
function emphasizeFricativeH(query, factor = 1.8, floor = 0.10) {
  for (const phrase of (query.accent_phrases || [])) {
    for (const mora of (phrase.moras || [])) {
      if (H_MORAS.has(mora.text) && mora.consonant_length != null) {
        mora.consonant_length = Math.max(floor, mora.consonant_length * factor);
      }
    }
  }
  return query;
}
//// /拉长 ハ 行辅音 ////

//// 据声调与 mora 数算一个音节各 mora 的普通话四声目标音高(相对基准的五度调值) [@busybee 2026-06-15] ////
// 一声 55 高平、二声 35 升、三声 21 低(连读半三声)、四声 51 降、轻声中略低。单拍取关键调值,走势靠相邻音节体现。
function mandarinTone(tone, moras, base) {
  const HI = base + 0.38;
  const MID = base;
  const LOW = base - 0.38;
  const BOTTOM = base - 0.50;
  const clamp = (value) => Math.max(4.8, Math.min(6.6, value));
  const out = [];
  const ramp = (lo, hi) => { for (let i = 0; i < moras; i += 1) out.push(lo + (hi - lo) * (i / (moras - 1))); };
  if (moras === 1) {
    const single = { 1: HI, 2: HI, 3: LOW, 4: HI, 5: MID - 0.08 };
    return [clamp(single[tone] !== undefined ? single[tone] : MID)];
  }
  if (tone === 1) {
    for (let i = 0; i < moras; i += 1) out.push(HI);
  } else if (tone === 2) {
    ramp(MID, HI);
  } else if (tone === 3) {
    ramp(LOW, BOTTOM);
  } else if (tone === 4) {
    ramp(HI, LOW);
  } else {
    for (let i = 0; i < moras; i += 1) out.push(MID - 0.08);
  }
  return out.map(clamp);
}
//// /据声调与 mora 数算普通话四声目标音高 ////

//// 在自然时长的 query 上铺普通话四声音高:按计划逐音节吞 mora、覆盖该音节片假名,替换有声 mora 的音高 [@busybee 2026-06-15] ////
// 与 applyTones 的轻微叠加不同,这里把四声调值完整铺上(在重音核路线的自然时长上),把四声都做分明;基准取 query 自身均值。
function applyMandarinTones(query, plan) {
  const moras = [];
  for (const phrase of (query.accent_phrases || [])) {
    for (const mora of (phrase.moras || [])) {
      moras.push(mora);
    }
  }
  const voiced = moras.filter((mora) => mora.pitch > 0);
  const base = voiced.length ? voiced.reduce((sum, mora) => sum + mora.pitch, 0) / voiced.length : 5.75;

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
    const contour = mandarinTone(syllable.tone, group.length, base);
    for (let i = 0; i < group.length; i += 1) {
      if (group[i].pitch > 0 && contour[i] !== undefined) {
        group[i].pitch = contour[i];
      }
    }
  }
  return query;
}
//// /在自然时长的 query 上铺普通话四声音高 ////

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

//// 据声调与音节 mora 数算各 mora 的音高微调量(相对 0 的增量,不替换引擎的自然音高) [@busybee 2026-06-15] ////
// 只给一个轻微偏置:一声略抬、二声尾升、三声压低、四声尾降、轻声略低。增量小,保留 VOICEVOX 自然起伏,听感更自然。
// 单 mora 取代表增量(调内走势难展开,靠相邻音节体现);多 mora 用线性走势。
function toneContour(tone, moras) {
  const out = [];
  const fill = (value) => { for (let i = 0; i < moras; i++) out.push(value); };
  const ramp = (lo, hi) => {
    for (let i = 0; i < moras; i++) {
      out.push(lo + (hi - lo) * (i / (moras - 1)));
    }
  };
  if (moras === 1) {
    const single = { 1: 0.12, 2: 0.14, 3: -0.18, 4: 0.10, 5: -0.05 };
    out.push(single[tone] !== undefined ? single[tone] : 0);
    return out;
  }
  if (tone === 1) {
    fill(0.12);
  } else if (tone === 2) {
    ramp(-0.04, 0.18);
  } else if (tone === 3) {
    ramp(-0.20, -0.08);
  } else if (tone === 4) {
    ramp(0.16, -0.18);
  } else {
    fill(-0.05);
  }
  return out;
}
//// /据声调与音节 mora 数算各 mora 的音高微调量 ////

//// 按声调计划给 query 各 mora 的音高叠一个轻微偏置,保留引擎自然起伏 [@busybee 2026-06-15] ////
// 把全句 mora 铺平;按计划逐音节吞 mora,直到吞下的 mora 文本覆盖该音节的片假名,据实际吞到的 mora 数算微调量;
// 只在引擎给的音高上加增量(不替换),strength 缩放偏置强度,只改有声 mora,结果夹在合法区间。
function applyTones(query, plan, options = {}) {
  const strength = options.strength != null ? options.strength : 1.0;
  const moras = [];
  for (const phrase of (query.accent_phrases || [])) {
    for (const mora of (phrase.moras || [])) {
      moras.push(mora);
    }
  }

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
    const deltas = toneContour(syllable.tone, group.length);
    for (let i = 0; i < group.length; i += 1) {
      if (group[i].pitch > 0 && deltas[i] !== undefined) {
        group[i].pitch = Math.max(4.8, Math.min(6.6, group[i].pitch + deltas[i] * strength));
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
  sentenceToAccentKana,
  mandarinTone,
  applyMandarinTones,
  smoothPitch,
  emphasizeFricativeH,
  markNasalContrast,
  toneContour,
  applyTones,
  flowPhrases,
  shapeFlow,
  moraCount,
  INITIAL_CV,
  FINAL_KANA
};
