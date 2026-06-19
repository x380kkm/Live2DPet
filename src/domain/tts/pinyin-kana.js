// audience: internal
// # pinyin-kana
// 拼音到片假名的拼装层:把带声调数字的拼音拆成声母、韵母、声调(parsePinyin),用最接近的片假名拼出近似音节(syllableToKana),
// 再把拼音与标点拼成带重音的片假名与声调计划(sentenceToAccentKana):停顿组按词边界切子短语、组内连读。
// 不变量:纯逻辑无副作用;声母拼到韵母首元音上;未知韵母回 ok:false、不抛。

const { ASPIRATED_INITIALS, BARE_VOWEL_KANA, BARE_YI_DEFAULT_FINALS, BASE_VOWEL, COMBINING, DENTAL_EMPTY_RHYME, ELONGATE_FINALS, ELONGATE_VOWEL, FINAL_KANA, GLIDE_INITIAL_FINALS, INITIALS, INITIAL_CV, I_SERIES_FINALS, PALATAL_INITIALS, RETROFLEX_EMPTY_RHYME, U_GLIDE_FINALS, Y_MEDIAL } = require('./chinese-tables');

//// 数片假名的 mora 数:小书写假名并入前一个,其余各计一个 [@x380kkm 2026-06-15] ////
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

//// 把一个带声调数字的拼音音节拆成声母、韵母、声调 [@x380kkm 2026-06-15] ////
// 末尾 1 到 5 为声调,无则记轻声 5;j/q/x/y 后的 u 实为 ü。
function parsePinyin(raw) {
  const text = String(raw || '').trim().toLowerCase();
  const toneMatch = text.match(/([1-5])$/);
  const tone = toneMatch ? parseInt(toneMatch[1], 10) : 5;
  const body = text.replace(/[1-5]$/, '');
  // 纯鼻音叹词(嗯 ng、n;呣 m):整体是成音节鼻音,须在按声母前缀匹配之前拦下,否则 ng 被当成声母 n + 韵母 g、g 不是合法韵母而拼空、整字没声。统一记 final 为 ng(由 FINAL_KANA 拼成 ウン)。
  if (/^(ng|n|m)$/.test(body)) {
    return { initial: '', final: 'ng', tone, body };
  }
  let initial = '';
  for (const candidate of INITIALS) {
    if (body.startsWith(candidate)) {
      initial = candidate;
      break;
    }
  }
  let final = body.slice(initial.length);
  // j/q/x 后的 u 实为 ü(去 qü、需 xü、句 jü)。
  if (['j', 'q', 'x'].includes(initial) && final.startsWith('u')) {
    final = 'ü' + final.slice(1);
  }
  // y 是零声母拼写,不是真声母:还原回带 i 介音的韵母(爷 ye→ie、烟 yan→ian),声母清空(介音已编码进韵母片假名)。
  // yu 系列还原成 ü(鱼 yu→ü、约 yue→üe);yi/yin/ying 本就 i 起头,清掉声母即可。w 行靠 INITIAL_CV 的 w 列拼介音(我 ウォ、为 ウェ),拼得更准,不在此还原。
  if (initial === 'y') {
    initial = '';
    if (final.startsWith('u')) final = 'ü' + final.slice(1);
    else if (Y_MEDIAL.has(final)) final = 'i' + final;
  }
  return { initial, final, tone, body };
}
//// /把一个拼音音节拆成声母、韵母、声调 ////

//// 把声母拼到韵母首元音上:取首元音定列(ユ 为 ü 列),换成声母加该元音的拼法 [@x380kkm 2026-06-15] ////
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

//// 把一个拼音音节拼成片假名,单元音韵母可补长音ー,回 { kana, moras, ok } [@x380kkm 2026-06-15] ////
// 长音让中文单元音持续得更像中文、把单拍拉成两拍承调;但 AquesTalk 风记法不收 ー,故重音核路线传 elongate:false 关掉。
function syllableToKana(parsed, options = {}) {
  const finalKana = FINAL_KANA[parsed.final];
  if (!finalKana) {
    return { kana: '', moras: 0, ok: false };
  }
  let kana = applyInitial(parsed.initial, finalKana);
  // h + u 介音的 [xw](花、欢、火、会):日语无 [xw]。说话默认改用 フ 行把介音与韵腹并成一个 mora(花 hua→ファ、欢 huan→ファン),听感更像一个整字(实听确认 ファン 最接近「欢」)。
  // 但歌唱在长音上 フ 行会被听成 f(花听成发),故 options.hGlideOnset 为真时改用 ホ 起音加韵腹(花 hua→ホア),起音短、韵腹长。
  if (parsed.initial === 'h' && U_GLIDE_FINALS.has(parsed.final)) {
    const rest = finalKana.slice(1); // 去掉介音 ウ,余下韵腹与韵尾
    if (options.hGlideOnset) {
      kana = 'ホ' + rest;
    } else {
      const nucleus = BASE_VOWEL[rest[0]];
      kana = nucleus ? (INITIAL_CV.f[nucleus] || 'フ') + rest.slice(1) : 'フ' + rest;
    }
  }
  // 零声母 i 系韵母:首拍纯元音「イ」起音弱,与前字之间无辅音界限时被前字鼻韵尾或前字元音吸收成近乎静音(益实测均方根能量仅 0.0107)。
  // 仿 wu→ヴ 在韵母前加一个起音「ユ」给 [j] 起头、不被吸收,保留原韵母结构:纯 i「イ」→「ユイ」、有 iou「イウ」→「ユイウ」。前加而非整字替换,故复韵母的韵腹韵尾不丢、不会念成「yì」。
  // 默认只作用于纯 i;options.bareYiFinals 给一组要加起音的韵母、options.bareYiAll 扩到全部 i 系。前加 ユ 后已两拍起步,纯 i 跳过补拍、否则拼成「ユイイ」三拍。
  const onsetFinals = options.bareYiAll ? I_SERIES_FINALS
    : (options.bareYiFinals ? new Set(options.bareYiFinals) : BARE_YI_DEFAULT_FINALS);
  const bareYi = parsed.initial === '' && options.bareYiGlide !== false && onsetFinals.has(parsed.final);
  if (bareYi) {
    kana = 'ユ' + kana;
  }
  const elongate = options.elongate !== false;
  if (elongate && ELONGATE_FINALS.has(parsed.final) && parsed.tone !== 5 && !bareYi) {
    // 重音核路线传 kanaSafe:不收长音ー,改用重复基元音补一拍;否则用长音ー。
    // 舌尖前空韵(z/c/s + i)用 ス/ズ/ツ 基([u]),补拍随基用 ウ、不用 イ——イ 会把音色拽回腭化的 シ([ɕi])、听成 xi。
    const padVowel = (parsed.final === 'i' && DENTAL_EMPTY_RHYME.has(parsed.initial)) ? 'ウ' : (ELONGATE_VOWEL[parsed.final] || '');
    kana += options.kanaSafe ? padVowel : 'ー';
  }
  return { kana, moras: moraCount(kana), ok: true, bareYi };
}
//// /把一个拼音音节拼成片假名 ////

//// 判断一个 token 是不是标点,中英逗号句号、括号都算(括号驱动前后停顿) [@x380kkm 2026-06-16] ////
function isPunctuation(token) {
  return /^[，,。.、!?！？；;：:（）()【】〔〕]+$/.test(token);
}

//// 把一个停顿组按词边界打包成至多 max 个音节的子短语:词整体不拆、短组不切 [@x380kkm 2026-06-15] ////
// 太长的停顿组不重新锚定会飘、识别率骤降;机械按固定音节切又会从词中切断。这里只在词与词之间断,既重新锚定又不拆词。
// wordStart[i] 为真表示第 i 个音节是一个词的开头;无词信息时调用方传全真,退化为按音节数的等长切。
function chunkAtWords(items, wordStart, max) {
  if (items.length <= max) {
    return [items];
  }
  const words = [];
  for (let i = 0; i < items.length; i += 1) {
    if (i === 0 || wordStart[i]) {
      words.push([items[i]]);
    } else {
      words[words.length - 1].push(items[i]);
    }
  }
  const chunks = [];
  let current = [];
  for (const word of words) {
    if (current.length && current.length + word.length > max) {
      chunks.push(current);
      current = [];
    }
    current = current.concat(word);
  }
  if (current.length) {
    chunks.push(current);
  }
  return chunks;
}
//// /把一个停顿组按词边界打包成至多 max 个音节的子短语 ////

//// 把一个子短语再按零声母纯元音切开:纯元音音节各自成段,得一个独立起音,免得黏进前一鼻音(宠物听成葱) [@x380kkm 2026-06-15] ////
function splitBareVowel(sub) {
  const pieces = [];
  let piece = [];
  for (const kana of sub) {
    if (BARE_VOWEL_KANA.has(kana)) {
      if (piece.length) {
        pieces.push(piece);
        piece = [];
      }
      pieces.push([kana]);
    } else {
      piece.push(kana);
    }
  }
  if (piece.length) {
    pieces.push(piece);
  }
  return pieces;
}
//// /把一个子短语再按零声母纯元音切开 ////

//// 判断相邻两字是否构成同源连读:前字收于真前高元音 i/ü,后字声母与之同源(腭化 j/q/x,或零声母 i/ü 起音) [@x380kkm 2026-06-18] ////
// 同源相接的两字之间无辅音界限,引擎拼成一长滑音(继续 ji-xu、需要 xu-yao 黏住)。判为真时,上游在前字尾加促音 ッ 掐断。
// 前字须收于真前高 [i]/[y]:空韵的舌尖 i(资/知)非前高,排除;ü/v 都算。
function isHomorganicLiaison(cur, next) {
  if (!cur || !next) return false;
  const curFrontHigh = (cur.final === 'i' && !DENTAL_EMPTY_RHYME.has(cur.initial) && !RETROFLEX_EMPTY_RHYME.has(cur.initial))
    || cur.final === 'ü' || cur.final === 'v';
  if (!curFrontHigh) return false;
  if (PALATAL_INITIALS.has(next.initial)) return true;
  // 后字零声母且韵母以 i/ü 起头(祎 yi→i、云 yün→ün):y 介音与前字前高元音同源、最易黏连。
  return next.initial === '' && /^[iüv]/.test(next.final || '');
}
//// /判断相邻两字是否构成同源连读 ////

//// 把拼音与标点拼成 AquesTalk 风格带重音的片假名与声调计划:停顿组按词边界切子短语,组内 / 连读、组间 、停顿 [@x380kkm 2026-06-15] ////
// 长停顿组按词边界切成至多 maxPhrase 个音节的子短语重新锚定(不切会飘、识别率骤降;机械按固定音节切又拆词);
// 词边界由 options.wordStart(与 tokens 对齐的真值数组)给出,缺省时每音节自成词、退化为等长切。再把零声母纯元音音节各自切出来给独立起音。
// 先三声变调(默认关),再据声调置重音核让引擎按重音生成自然时长(不补长音,AquesTalk 不收 ー)。返回 { kana, plan }。
function sentenceToAccentKana(tokens, options = {}) {
  // 韵律记号记作 phrase 项,带切分等级:`/` 韵律短语边界(minor)、`·` 韵律词边界(word);默认在前一字尾出促音切分。标点记作 punct 项,断成组、给静音停顿。
  const items = tokens.map((token) => {
    if (isPunctuation(token)) return { punct: token };
    if (token === '/') return { phrase: 'minor' };
    if (token === '·') return { phrase: 'word' };
    return { parsed: parsePinyin(token) };
  });
  // 三声变调默认关:变调会把「你好」的「你」读成上扬的二声、听感像「尼」;需要时传 sandhi:true 打开。
  if (options.sandhi) {
    applyToneSandhi(items, options.wordStart);
  }

  // 每子短语最多几个音节:取 8,只把很长的停顿组按词边界切成子短语重新锚定(子短语间 / 无停顿、合成后合并),
  // 不再据此自动断句——句内停顿改由 LLM 插的 `/` 记号驱动(分词对生僻词、专名不可靠,机械切会切坏「罗生门」、孤立「的」)。
  const maxPhrase = options.maxPhrase || 8;
  const wordStart = options.wordStart || null;
  // 句类型(陈述/是非问/特指问/感叹),供 applySentenceIntonation 铺句调:陈述句末压低、是非问句末上扬、特指问与陈述同走下降。
  const sentenceType = options.sentenceType || 'statement';
  const plan = [];
  const groups = [];
  const groupWordStarts = [];
  let current = [];
  let currentWordStart = [];
  // 标记每个停顿组的首音节,供 applyMandarinTones 在组内做语调下倾、并在停顿处重置。
  let groupStart = true;
  for (let i = 0; i < items.length; i += 1) {
    const item = items[i];
    // 韵律记号(item.phrase 为 'minor'/`/` 韵律短语边界、'word'/`·` 韵律词边界):默认在前一字尾加促音 ッ 做句内切分,
    // 同组连读、不插静音、不打断语气;促音大小按等级由 sizeSokuon 定(word 极短、minor 较大)。显式传 sokuonSegment 为 false 时退回旧行为。
    if (item.phrase) {
      if (options.sokuonSegment !== false) {
        const lastKana = current[current.length - 1];
        if (lastKana && !lastKana.endsWith('ッ')) {
          current[current.length - 1] = lastKana + 'ッ';
          const last = plan[plan.length - 1];
          last.kana += 'ッ';
          last.moras = moraCount(last.kana);
          last.sokuon = item.phrase;
        }
        continue;
      }
      // 关促音:`/` 退回静音半停(切组),`·` 韵律词边界丢弃(连读、不停)。
      if (item.phrase === 'minor' && current.length) {
        groups.push(current);
        groupWordStarts.push(currentWordStart);
        current = [];
        currentWordStart = [];
        plan[plan.length - 1].breakAfter = 'minor';
        groupStart = true;
      }
      continue;
    }
    if (item.punct) {
      if (current.length) {
        groups.push(current);
        groupWordStarts.push(currentWordStart);
        current = [];
        currentWordStart = [];
        // 记下这个组边界的停顿等级:顿号是列举半停(pph)、其余标点(逗号、句号等)是语调短语全停(full)。供 sizePhrasePauses 给 pause_mora 定长。
        // 顿号比逗号短一档,免得「桂林、象郡，百越」里顿号与逗号同长、逗号听着没停。
        plan[plan.length - 1].breakAfter = item.punct === '、' ? 'pph' : 'full';
      }
      groupStart = true;
      continue;
    }
    // 默认开补拍:单元音单拍太短、听着发闷,补一拍更饱满(实听确认)。补拍会拉低 ASR 识别率,但本模式以听感为准,显式传 elongate:false 可关。
    const syllable = syllableToKana(item.parsed, { elongate: options.elongate !== false, kanaSafe: true, bareYiGlide: options.bareYiGlide, bareYiFinals: options.bareYiFinals, bareYiAll: options.bareYiAll });
    if (!syllable.ok || syllable.moras === 0) {
      continue;
    }
    // 同源连读:当前字收于前高元音 i/ü、下一字声母与之同源时,两字间无辅音界限会黏成一长滑音(继续 ji-xu 黏住)。
    // 在当前字尾加一个促音 ッ,用一个极短的辅音闭合/喉塞掐断滑音(继续→ジイッシュイ),两字仍同处一短语、不插停顿,既断开又不打断口音的连贯。
    // 促音来源记进 plan[s].sokuon,供 sizeSokuon 按级定闭合时长:连读(liaison)最短、`/` 韵律边界(minor)较长——大小即切分强度。
    let sokuon = null;
    const nextItem = items[i + 1];
    if (nextItem && nextItem.parsed && isHomorganicLiaison(item.parsed, nextItem.parsed)) {
      syllable.kana += 'ッ';
      syllable.moras = moraCount(syllable.kana);
      sokuon = 'liaison';
    }
    current.push(syllable.kana);
    currentWordStart.push(wordStart ? Boolean(wordStart[i]) : true);
    // 韵尾标记:后鼻韵尾(-ng)记 'ng'、前鼻韵尾(-n)记 'n',供 adjustNasalCoda 按韵尾调鼻音占比、区分 -n/-ng。
    const fin = item.parsed.final || '';
    const nasalCoda = /ng$/.test(fin) ? 'ng' : (/n$/.test(fin) ? 'n' : null);
    // 空韵标记:韵母是 i、声母在舌尖前/后空韵集合时,这个 i 是舌尖元音(资/知/师),供 apicalizeEmptyRhyme 按类拉长声母擦音。
    const emptyRhyme = fin === 'i'
      ? (DENTAL_EMPTY_RHYME.has(item.parsed.initial) ? 'dental'
        : (RETROFLEX_EMPTY_RHYME.has(item.parsed.initial) ? 'retroflex' : null))
      : null;
    // 塞擦空韵标记:舌尖前空韵里 z/c(塞擦 [ts])的成音节身子是那段塞擦,落短位置(此/次)塞擦太短就塌;s(擦音 [s])的咝声短也听得见、不算。供 ensureMainVowelShare 给塞擦保比重、不碰 s。
    const dentalAffricate = emptyRhyme === 'dental' && item.parsed.initial !== 's';
    // er 韵标记:儿/二/而 的韵母是 er(片假名 アル),供 tightenErhuaTail 压短 ル 尾、不让它成独立的「鲁」音节;同时收好儿化。
    const erFinal = fin === 'er';
    // 零声母介音字标记:零声母且韵母带前介音(又 iou、王 uang),首拍介音 [j]/[w] 是唯一起音,过短会塌成纯元音(又→欧),供 floorGlideOnset 给介音保底。
    const zeroGlide = item.parsed.initial === '' && GLIDE_INITIAL_FINALS.has(fin);
    plan.push({ kana: syllable.kana, moras: syllable.moras, tone: item.parsed.tone, groupStart, aspirated: ASPIRATED_INITIALS.has(item.parsed.initial), sentenceType, nasalCoda, emptyRhyme, erFinal, final: fin, sokuon, bareYi: syllable.bareYi, zeroGlide, dentalAffricate });
    groupStart = false;
  }
  if (current.length) {
    groups.push(current);
    groupWordStarts.push(currentWordStart);
  }

  // 每个停顿组按词边界切成 ≤maxPhrase 的子短语(子短语间 / 无停顿),再把零声母纯元音音节各自切出来(给「物」独立起音);
  // 组间用 、停顿;实际四声听感由 applyMandarinTones 铺音高、节奏由 shapeChineseRhythm 整时长决定。
  const kana = groups
    .map((group, gi) => chunkAtWords(group, groupWordStarts[gi], maxPhrase)
      .flatMap((sub) => splitBareVowel(sub))
      .map((piece) => piece.join('') + "'")
      .join('/'))
    .join('、');
  return { kana, plan };
}
//// /把拼音与标点拼成 AquesTalk 风格带重音的片假名与声调计划 ////

//// 三声变调:按词边界分两步,词内从左到右、整体从右到左,相邻三声里前一个改读二声 [@x380kkm 2026-06-16] ////
// 三个及以上三声相连时,变调取决于词的切分:双音节词+单音节词(保管好)读二二三,单音节词+双音节词(老保管)读三二三。
// 故先做词内变调(双音节词的非末三声先变二声),再整体从右到左扫一遍;两步合起来:保管好→2-2-3、老保管→3-2-3、我很好(三个单字)→3-2-3、你好→2-3。
// wordStart 与 items 对齐、标 token 是否为词首;无词信息时每音节自成词,退化为纯从右到左。标点断开变调域,句内 `/` 记号对变调透明。
function applyToneSandhi(items, wordStart) {
  const isWordStart = (i) => (wordStart ? Boolean(wordStart[i]) : true);
  // 第一步:词内从左到右——非词末的三声若后接同词三声,变二声(双音节词 保管→保(2)管(3))。
  for (let i = 0; i < items.length; i += 1) {
    const it = items[i];
    if (!it.parsed) continue;
    let j = i + 1;
    while (j < items.length && items[j].phrase) j += 1; // `/` 记号透明
    if (j >= items.length || !items[j].parsed) continue; // 到头或遇标点(标点无 parsed)→ 不变
    if (!isWordStart(j) && it.parsed.tone === 3 && items[j].parsed.tone === 3) {
      it.parsed.tone = 2; // 下一音节非词首 → 同词,词内前一个三声变二声
    }
  }
  // 第二步:整体从右到左——三声若后接(当前)三声,变二声;补齐跨词与单字串的变调。
  let next = null;
  for (let i = items.length - 1; i >= 0; i -= 1) {
    const item = items[i];
    if (item.punct) { next = null; continue; }
    if (item.phrase) continue; // 句内断句记号对变调透明,不重置、不跨断
    if (next && item.parsed.tone === 3 && next.tone === 3) {
      item.parsed.tone = 2;
    }
    next = item.parsed;
  }
}
//// /三声变调 ////

module.exports = { moraCount, parsePinyin, syllableToKana, isPunctuation, isHomorganicLiaison, sentenceToAccentKana };
