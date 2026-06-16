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
  // z/c/s 的 i 列是普通话舌尖元音(资、次、四),日语サ/ザ/タ行无 [si/tsi/dzi]:
  // 用拗音 ズィ/ツィ/スィ([zi/tsi/si],不圆唇)比 ズ/ツ/ス([zu/tsu/su],圆唇)更近普通话,
  // 也把「是」(シ shi)与「四」(スィ si)分成两个清楚的 mora、不黏成一个字。u 列仍是ズ/ツ/ス(苏、粗、租 本就读 [u])。
  z: { a: 'ザ', i: 'ズィ', u: 'ズ', e: 'ゼ', o: 'ゾ' },
  c: { a: 'ツァ', i: 'ツィ', u: 'ツ', e: 'ツェ', o: 'ツォ' },
  s: { a: 'サ', i: 'スィ', u: 'ス', e: 'セ', o: 'ソ' },
  y: { a: 'ヤ', i: 'イ', u: 'ユ', e: 'イェ', o: 'ヨ', v: 'ユ' },
  // wu(物、五、无)的 u 列用 ヴ 不用 ウ:纯元音 ウ 没有起音、会黏进前一字的鼻音(宠物听成葱),
  // ヴ 给一个清楚的浊起音把这个字分出来。听感是 [vu] 偏 [wu],带点口音但是个独立的字、不会丢。
  w: { a: 'ワ', i: 'ウィ', u: 'ヴ', e: 'ウェ', o: 'ウォ' }
};

// 韵母的零声母片假名:首字符是声母要拼上去的基元音(ア/イ/ウ/エ/オ),其后是介音、韵尾。
// 后鼻韵尾 -ng 与前鼻韵尾 -n 都收到 ン:补长音区分会把音节拖长、连读被拖累,得不偿失,宁可不分。
const FINAL_KANA = {
  // e[ɤ] 用 ウア 滑音近似:单用 ウ 会把恶/课/了发成 u(实听确认);ウ 起、滑向 ア,比单元音更像 ㄜ。本就两拍,不在补拍名单。
  a: 'ア', o: 'オ', e: 'ウア', ê: 'エ',
  ai: 'アイ', ei: 'エイ', ao: 'アオ', ou: 'オウ',
  an: 'アン', en: 'エン', ang: 'アン', eng: 'エン', ong: 'オン',
  er: 'アル',
  i: 'イ', ia: 'イア', ie: 'イエ', iao: 'イアオ', iu: 'イウ', iou: 'イウ',
  ian: 'イエン', in: 'イン', iang: 'イアン', ing: 'イン', iong: 'イオン',
  u: 'ウ', ua: 'ウア', uo: 'ウオ', uai: 'ウアイ', ui: 'ウイ', uei: 'ウイ',
  uan: 'ウアン', un: 'ウン', uen: 'ウン', uang: 'ウアン', ueng: 'ウオン',
  // ü[y] 是前高圆唇,日语只有后高的 ウ;单用 ユ 接腭化声母会拼成 チュ[tɕu](去听成 chu)。
  // 改用 ユイ:在 ュ 后补个前元音 イ 把音色前移(去 qü→チュイ、需 xü→シュイ、鱼 yü→ユイ),实听比 チュ 更像 ü。
  ü: 'ユイ', v: 'ユイ', üe: 'ユエ', ve: 'ユエ', üan: 'ユエン', van: 'ユエン', ün: 'ユン', vn: 'ユン'
};

// 基元音片假名到元音字母,供声母按韵母首元音选拼法。
const BASE_VOWEL = { ア: 'a', イ: 'i', ウ: 'u', エ: 'e', オ: 'o' };
// 与前一基音合成一个 mora 的小书写假名,数 mora 时跳过。
const COMBINING = new Set(['ァ', 'ィ', 'ゥ', 'ェ', 'ォ', 'ャ', 'ュ', 'ョ']);
// 单元音韵母:中文这些音比日语 mora 长而平,补一拍拉成两拍,既更像中文也给升降调留出展开空间(轻声不拉)。
// ü/v(ユイ)与 e(ウア)不在此列:它们的片假名本就有两拍,不再另补,否则会拼成三拍过长。
const ELONGATE_FINALS = new Set(['a', 'o', 'ê', 'i', 'u']);
// 重音核路线不收长音ー,改用重复基元音补拍(ニ→ニイ);每个单元音韵母对应的补拍假名。
const ELONGATE_VOWEL = { a: 'ア', o: 'オ', ê: 'エ', i: 'イ', u: 'ウ' };
// 带 u 介音的韵母(花、欢、火、会):声母 h 在这些韵母上单独走 フ 行融合拼法,见 syllableToKana。
const U_GLIDE_FINALS = new Set(['ua', 'uo', 'uai', 'ui', 'uei', 'uan', 'un', 'uen', 'uang', 'ueng']);
// 声母按长到短匹配,zh/ch/sh 优先于单字母。
const INITIALS = ['zh', 'ch', 'sh', 'b', 'p', 'm', 'f', 'd', 't', 'n', 'l', 'g', 'k', 'h', 'j', 'q', 'x', 'r', 'z', 'c', 's', 'y', 'w'];
// 普通话送气声母:这些字的塞音/塞擦音要送气([pʰ tʰ kʰ tɕʰ tsʰ tʂʰ]),日语只在短语首才给清塞音送气,见 splitFinalAspiratedStop。
const ASPIRATED_INITIALS = new Set(['p', 't', 'k', 'q', 'c', 'ch']);

// 中文句合成的 audio_query 推荐参数(实听迭代定):语速 1.3 抵消单元音补拍带来的整体变长,音节与停顿一起压紧、不拖不留长间隔;
// 音量 1.25 更响更干脆;句首句尾留白收窄,句尾不拖。speedScale 在 VOICEVOX 同时压缩音节与停顿。
// 调用方取 query 后铺上这组值,再调 applyChineseProsody 整条韵律流水线。
const CHINESE_QUERY_DEFAULTS = { speedScale: 1.3, volumeScale: 1.25, prePhonemeLength: 0.08, postPhonemeLength: 0.1 };

// 个别声线偏高,按 styleId 单独压低全局音高(pitchScale);只列需要调的,其余按 0 不动。
// 26 = WhiteCUL びえーん:实听偏高,压 -0.08。
const CHINESE_VOICE_PITCH = { 26: -0.08 };
//// 取某声线的中文全局音高偏移,未列出的声线为 0(不动) [@x380kkm 2026-06-16] ////
function chineseVoicePitch(styleId) {
  return CHINESE_VOICE_PITCH[styleId] != null ? CHINESE_VOICE_PITCH[styleId] : 0;
}

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
  // h + u 介音的 [xw](花、欢、火、会):日语无 [xw],拼成 ホ+元音(ホアン)会拆成两个元音、听着像「ho-a-n」;
  // 改用 フ 行,把介音与韵腹并成一个 mora(欢 huan→ファン、花 hua→ファ、火 huo→フォ、会 hui→フィ),听感更像一个整字(实听确认 ファン 最接近「欢」)。
  if (parsed.initial === 'h' && U_GLIDE_FINALS.has(parsed.final)) {
    const rest = finalKana.slice(1); // 去掉介音 ウ,余下韵腹与韵尾
    const nucleus = BASE_VOWEL[rest[0]];
    kana = nucleus ? (INITIAL_CV.f[nucleus] || 'フ') + rest.slice(1) : 'フ' + rest;
  }
  const elongate = options.elongate !== false;
  if (elongate && ELONGATE_FINALS.has(parsed.final) && parsed.tone !== 5) {
    // 重音核路线传 kanaSafe:不收长音ー,改用重复基元音补一拍;否则用长音ー。
    kana += options.kanaSafe ? (ELONGATE_VOWEL[parsed.final] || '') : 'ー';
  }
  return { kana, moras: moraCount(kana), ok: true };
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

// 零声母纯元音音节的片假名:这几个独立成 mora 的纯元音(如「物」ウ、「一」イ)没有声母作起音,易黏进前一鼻音听成一个字。
const BARE_VOWEL_KANA = new Set(['ア', 'イ', 'ウ', 'エ', 'オ']);

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

//// 把拼音与标点拼成 AquesTalk 风格带重音的片假名与声调计划:停顿组按词边界切子短语,组内 / 连读、组间 、停顿 [@x380kkm 2026-06-15] ////
// 长停顿组按词边界切成至多 maxPhrase 个音节的子短语重新锚定(不切会飘、识别率骤降;机械按固定音节切又拆词);
// 词边界由 options.wordStart(与 tokens 对齐的真值数组)给出,缺省时每音节自成词、退化为等长切。再把零声母纯元音音节各自切出来给独立起音。
// 先三声变调(默认关),再据声调置重音核让引擎按重音生成自然时长(不补长音,AquesTalk 不收 ー)。返回 { kana, plan }。
function sentenceToAccentKana(tokens, options = {}) {
  // `/` 是 LLM 插的断句记号,记作 phrase 项,断成组、给半半停顿;标点记作 punct 项,断成组、给全停顿。
  const items = tokens.map((token) => {
    if (isPunctuation(token)) return { punct: token };
    if (token === '/') return { phrase: true };
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
    if (item.punct || item.phrase) {
      if (current.length) {
        groups.push(current);
        groupWordStarts.push(currentWordStart);
        current = [];
        currentWordStart = [];
        // 记下这个组边界的停顿等级:标点全停顿,`/` 记号半半停顿。供 sizePhrasePauses 给 pause_mora 定长。
        plan[plan.length - 1].breakAfter = item.phrase ? 'minor' : 'full';
      }
      groupStart = true;
      continue;
    }
    // 默认开补拍:单元音单拍太短、听着发闷,补一拍更饱满(实听确认)。补拍会拉低 ASR 识别率,但本模式以听感为准,显式传 elongate:false 可关。
    const syllable = syllableToKana(item.parsed, { elongate: options.elongate !== false, kanaSafe: true });
    if (!syllable.ok || syllable.moras === 0) {
      continue;
    }
    current.push(syllable.kana);
    currentWordStart.push(wordStart ? Boolean(wordStart[i]) : true);
    plan.push({ kana: syllable.kana, moras: syllable.moras, tone: item.parsed.tone, groupStart, aspirated: ASPIRATED_INITIALS.has(item.parsed.initial), sentenceType });
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

//// 据声调与 mora 数算一个音节各 mora 的普通话四声目标音高(相对基准的五度调值) [@x380kkm 2026-06-15] ////
// 一声 55 高平、二声 35 升、三声 21 低、四声 51 降、轻声中略低。单拍取关键调值,走势靠相邻音节体现。
// 连读协同:非句末四声只半降到中位、非句末三声读半三声(低平不下潜),免得连续四声成锯齿、中段三声又低又弱。
// 句末治虚:句末三声止于 FINAL3(不潜到最低)、句末四声落到 FINAL4、句末单拍三声略抬、四声略离顶,
// 让句尾的字站得住、不发虚,且四声不反转。spread 缩放整体落差(<1 更平缓),默认 1。
function mandarinTone(tone, moras, base, phraseFinal = true, spread = 1, riseScale = 1, lowDepth = 0.36, prevTone = null, nextTone = null, lift = {}) {
  // 四声压低(协同发音、偏弱):前接三/四声压低起音(顺向同化),后接四/一声压缩降幅(逆向异化);二声升高在 drawToneContours 里做(它重画二声)。
  const t4DropStart = lift.t4DropStart || 0;
  const t4Compress = lift.t4Compress || 0;
  const HI = base + 0.40 * spread;
  const MID = base;
  // 三声是压到底的低调:LOW 的下压深度由 lowDepth 控制(越大压得越深),二声也从这个低位起步抬升,故 LOW 深、三声才像三声、二声起伏才对。
  const LOW = base - lowDepth * spread;
  const FINAL3 = base - (lowDepth + 0.10) * spread;
  const FINAL4 = base - 0.34 * spread;
  // 上扬封顶:二声的升、三声的回升只升到 MID 与 HI 之间的 RISE(riseScale<1 即不完全的回升)。
  // 连读里二声升到顶、三声回升不及就接下个字,听着诡异;升一个不完全的量更自然。riseScale=1 即升满到 HI。
  const RISE = MID + riseScale * (HI - MID);
  // 轻声的高低随前一个字的调尾定(标准五度:前一声→2、前二声→3、前三声→4 高、前四声→1 低):
  // 反直觉的是前三声时轻声读高(你的、好的的「的」),不补这条「的」会被压低听不清。无前字信息时落中低位。
  const NEUTRAL_AFTER = { 1: base - 0.15 * spread, 2: base - 0.05 * spread, 3: base + 0.20 * spread, 4: base - 0.36 * spread };
  const NEUTRAL = (prevTone != null && NEUTRAL_AFTER[prevTone] != null) ? NEUTRAL_AFTER[prevTone] : base - 0.20 * spread;
  const clamp = (value) => Math.max(4.8, Math.min(6.6, value));
  const out = [];
  const ramp = (lo, hi) => { for (let i = 0; i < moras; i += 1) out.push(lo + (hi - lo) * (i / (moras - 1))); };
  if (moras === 1) {
    const single = { 1: HI, 2: RISE, 3: LOW, 4: HI, 5: NEUTRAL };
    // 句末单拍:三声略抬离最低;四声放中高位而非顶——句末单拍四声(如「物」)放顶会被引擎从低邻拍顶成上冲尖峰、
    // 冲到全句最高(实测 F0 反升、听感像二声),放中高位只是个收尾的小高点,不上冲。非句末单拍四声(气、去)仍放顶,保辨识。
    const singleFinal = { 1: HI, 2: RISE, 3: LOW + 0.10, 4: MID + 0.16, 5: NEUTRAL };
    const table = phraseFinal ? singleFinal : single;
    return [clamp(table[tone] !== undefined ? table[tone] : MID)];
  }
  if (tone === 1) {
    for (let i = 0; i < moras; i += 1) out.push(HI);
  } else if (tone === 2) {
    // 二声先低后抬:起点压到 LOW(前一个字常偏高,二声要先压下来一点),再升到 RISE(riseScale 控制升幅、不升满)。
    ramp(LOW, RISE);
  } else if (tone === 3) {
    // 三声先压后平,不回升:句末降到 FINAL3、不潜到最低;非句末低平住(回升会被听成上扬的二声「尼」)。
    if (phraseFinal) { ramp(LOW, FINAL3); } else { for (let i = 0; i < moras; i += 1) out.push(LOW); }
  } else if (tone === 4) {
    if (phraseFinal) {
      // 句末四声降到 FINAL4(比中位再低一点、保留落感但不潜),不受语境压低。
      ramp(HI, FINAL4);
    } else {
      // 半四声 + 语境压低:前接三/四声压低起音,后接四/一声压缩降幅,但始终保留略降(不变纯平)。
      const hiStart = (prevTone === 3 || prevTone === 4) ? HI - t4DropStart * spread : HI;
      let midEnd = (nextTone === 4 || nextTone === 1) ? MID + t4Compress * spread : MID;
      if (midEnd >= hiStart) midEnd = hiStart - 0.04 * spread;
      ramp(hiStart, midEnd);
    }
  } else {
    for (let i = 0; i < moras; i += 1) out.push(NEUTRAL);
  }
  return out.map(clamp);
}
//// /据声调与 mora 数算普通话四声目标音高 ////

//// 在自然时长的 query 上铺普通话四声音高:逐音节吞 mora 覆盖片假名,与引擎自然音高按 toneStrength 混合 [@x380kkm 2026-06-15] ////
// 按四声调值铺音高把声调做出来,但不完全替换——与引擎自身平滑的自然音高混合,既听得出四声、又保留自然过渡不突兀;基准取 query 自身均值。
// config:toneStrength 四声强度(1=完全按四声、最分明也最突兀;小=更自然、四声更淡)、spread 四声整体落差。
// spread 默认 0.7:多句识别率实测在 0.7 处有明显峰值(总 69%,卷舌句「学习中文」整句正确),
// 高于 0.8 后音高摆幅过大反把卷舌、擦音的辅音冲糊、识别率掉到 50% 以下、句尾还冲出尖峰(峰 F0 515→442Hz);故落差收到 0.7 兼顾识别率与不突兀。
function applyMandarinTones(query, plan, config = {}) {
  const toneStrength = config.toneStrength != null ? config.toneStrength : 1.0;
  const spread = config.spread != null ? config.spread : 0.7;
  // 上扬封顶比例:二声从低位抬起时只抬到 MID 与 HI 之间的此比例处(<1 即不完全地抬,免得连读里抬过头显诡异)。
  // 默认 0.5:实听二声「学」从低位抬到半程最自然,抬满到顶反而冲、像在喊。
  const riseScale = config.riseScale != null ? config.riseScale : 0.5;
  const lowDepth = config.lowDepth != null ? config.lowDepth : 0.36;
  // 二声升高 / 四声压低的协同发音偏移(默认弱):顺向(看前字)默认开,逆向(看后字)默认关(0,争议大),都可调。
  const lift = {
    t2LiftStart: config.t2LiftStart != null ? config.t2LiftStart : 0.18,
    t2LiftPeak: config.t2LiftPeak != null ? config.t2LiftPeak : 0,
    t4DropStart: config.t4DropStart != null ? config.t4DropStart : 0.14,
    t4Compress: config.t4Compress != null ? config.t4Compress : 0,
  };
  const moras = [];
  for (const phrase of (query.accent_phrases || [])) {
    for (const mora of (phrase.moras || [])) {
      moras.push(mora);
    }
  }
  const voiced = moras.filter((mora) => mora.pitch > 0);
  const base = voiced.length ? voiced.reduce((sum, mora) => sum + mora.pitch, 0) / voiced.length : 5.75;

  let index = 0;
  // 前一个字的(变调后)声调,供轻声按前字定高低;停顿组开头处重置不跨标点。
  let prevTone = null;
  for (let s = 0; s < plan.length; s += 1) {
    const syllable = plan[s];
    if (syllable.groupStart) {
      prevTone = null;
    }
    const target = (syllable.kana || '').length;
    const group = [];
    let covered = 0;
    while (index < moras.length && covered < target) {
      const mora = moras[index];
      index += 1;
      covered += (mora.text || '').length || 1;
      group.push(mora);
    }
    // 句末音节:全句最后一个,或下一个音节是新停顿组的开头。非句末走半四声、半三声的连读协同。
    const next = plan[s + 1];
    const phraseFinal = !next || Boolean(next.groupStart);
    // 后邻声调供四声压低判定;句末/跨停顿组时无连读后邻,置 null。
    const nextTone = phraseFinal ? null : next.tone;
    const contour = mandarinTone(syllable.tone, group.length, base, phraseFinal, spread, riseScale, lowDepth, prevTone, nextTone, lift);
    for (let i = 0; i < group.length; i += 1) {
      if (group[i].pitch > 0 && contour[i] !== undefined) {
        // 与引擎自然音高混合:四声做出来,但保留自然的平滑过渡,不那么突兀。
        const blended = group[i].pitch * (1 - toneStrength) + contour[i] * toneStrength;
        group[i].pitch = Math.max(4.8, Math.min(6.6, blended));
      }
    }
    prevTone = syllable.tone;
  }
  return query;
}
//// /在自然时长的 query 上铺普通话四声音高 ////

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

//// 把一个停顿组内的多个 accent_phrase 合并成一个,消除词间停顿与音高重置,让连读不打断 [@x380kkm 2026-06-15] ////
// VOICEVOX 把片假名按词切成多个 accent_phrase,词界会插微停顿并重置音高,中文听起来一顿一顿;
// 这里把相邻、其间没有停顿 mora 的 phrase 并成一个,只在标点与 `/` 记号的停顿处断开,合成出来就连贯。
// 例外:单独一个纯元音的 phrase(零声母字「物」ウ)不并入前一个,保住它的独立起音,免得黏成一个字。
function flowPhrases(query) {
  const phrases = (query && query.accent_phrases) || [];
  const merged = [];
  for (const phrase of phrases) {
    const last = merged[merged.length - 1];
    const bareVowel = (phrase.moras || []).length === 1 && BARE_VOWEL_KANA.has(((phrase.moras[0] || {}).text) || '');
    if (last && !last.pause_mora && !bareVowel) {
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

//// 把节奏整成更像中文:合并停顿组内的多个 accent_phrase 让组内连读,再把标点停顿收到适中 [@x380kkm 2026-06-15] ////
// 日语 mora 节奏一顿一顿、词界还插微停顿,听着不像中文。这里把同一停顿组的多个短语并成一个,清掉词界微停顿与音高重置,
// 组内连读;再把标点处过长的停顿收紧。只动短语结构与停顿、不动各 mora 的元辅音时长:实测抻长元音或压短辅音都会
// 把卷舌、擦音咬糊、显著拉低识别率,而合并加收停顿对识别率零损耗。config 可调 pauseCap。须在 applyMandarinTones 后调用。
function shapeChineseRhythm(query, config = {}) {
  const pauseCap = config.pauseCap != null ? config.pauseCap : 0.20;
  // 合并同一停顿组内的多个 accent_phrase,清掉词界微停顿与音高重置,组内连读(纯元音字不并,保独立起音)。
  flowPhrases(query);
  // 标点处残留的停顿封顶到适中,不抬高、只收紧过长的。
  for (const phrase of (query.accent_phrases || [])) {
    if (phrase.pause_mora && phrase.pause_mora.vowel_length != null) {
      phrase.pause_mora.vowel_length = Math.min(phrase.pause_mora.vowel_length, pauseCap);
    }
  }
  return query;
}
//// /把节奏整成更像中文:合并组内短语、收紧标点停顿 ////

//// 按 plan 的 breakAfter 给各组边界的 pause_mora 定长:标点全停顿、`/` 记号半半停顿 [@x380kkm 2026-06-16] ////
// plan 上 breakAfter 标了每个组边界的等级(full/minor),顺序与合并后 query 里带 pause_mora 的短语一一对应(停顿只在组边界出现);
// 按序取等级,把全停顿设为 fullPause、半半停顿设为 minorPause。须在 shapeChineseRhythm 合并之后调用。
function sizePhrasePauses(query, plan, config = {}) {
  const fullPause = config.fullPause != null ? config.fullPause : 0.20;
  const minorPause = config.minorPause != null ? config.minorPause : 0.06;
  const levels = [];
  for (const p of (plan || [])) { if (p.breakAfter) levels.push(p.breakAfter); }
  let k = 0;
  for (const phrase of (query.accent_phrases || [])) {
    if (phrase.pause_mora && phrase.pause_mora.vowel_length != null) {
      const level = levels[k]; k += 1;
      phrase.pause_mora.vowel_length = level === 'minor' ? minorPause : fullPause;
    }
  }
  return query;
}
//// /按 plan 的 breakAfter 给各组边界的 pause_mora 定长 ////

//// 把句末的送气塞音字单独切成一个无停顿短语,让它落在短语首被引擎送气(碳 tàn 不被听成 dàn) [@x380kkm 2026-06-15] ////
// 日语只在短语首给清塞音送那口气;句末送气字(p/t/k/q/c/ch)黏在前字后面就丢了送气、听成不送气的浊音。
// 这里把它切出来落到短语首,无停顿(不留空),换来送气;句末本就允许一点收尾的轻微强调。须在 shapeChineseRhythm 合并之后调用,否则又被并回去。
function splitFinalAspiratedStop(query, plan) {
  const phrases = (query && query.accent_phrases) || [];
  if (!phrases.length || !plan || !plan.length) {
    return query;
  }
  const last = plan[plan.length - 1];
  if (!last.aspirated) {
    return query;
  }
  const moraN = moraCount(last.kana || '');
  const lastPhrase = phrases[phrases.length - 1];
  // 整句仅剩这一字时它已在短语首,不动;否则把末 moraN 个 mora 切成尾随的无停顿短语。
  if (!lastPhrase || (lastPhrase.moras || []).length <= moraN) {
    return query;
  }
  const tail = lastPhrase.moras.splice(lastPhrase.moras.length - moraN, moraN);
  lastPhrase.pause_mora = null;
  phrases.push({ moras: tail, accent: 1, pause_mora: null, is_interrogative: false });
  return query;
}
//// /把句末的送气塞音字单独切成一个无停顿短语 ////

//// 把各音节时长双向拉平(短字拉长、长字收短)向全句平均靠拢、匀化节奏,句末音节再额外拉长收个气声尾 [@x380kkm 2026-06-15] ////
// 普通话近音节等时,日语引擎按 mora 给时长忽长忽短:短字(去 チュ、书 シュ、最 ズイ)被压短咬不清,长字(图书馆的 馆 グアン)又拖慢。
// 这里逐音节算总时长,只缩放元音向全句平均靠拢(strength=1 完全拉平、=0 不动):短字拉长、长字收短,整句节奏匀。
// 缩放倍率夹在 [0.6, maxScale],下限 0.6 限制长字最多收到六成、上限放宽到 2 让被压得很短的字也能拉够;末音节再乘 finalBoost 收个气声尾。
// 只动元音、不动辅音(辅音是擦音、塞音的关键,改了会咬糊)。须在 applyMandarinTones 之后调用。
function normalizeSyllableDurations(query, plan, config = {}) {
  // 拉平强度默认 0.5(不完全压到均值):完全拉平(1.0)把每个字压成一样长、抹平自然长短、听着匀而仓促;
  // 0.5 只把过短的字拉长一半、保留一半自然起伏,实听更自然不显快。
  const strength = config.normalizeStrength != null ? config.normalizeStrength : 0.5;
  const maxScale = config.normalizeMaxScale != null ? config.normalizeMaxScale : 2.0;
  const finalBoost = config.finalBoost != null ? config.finalBoost : 1.3;
  // 轻声(半音节)目标时长是全句平均的此比例:轻声该比实词短、但默认 0.85(不压太短),太短会仓促;它不参与向均值拉长。
  const lightFactor = config.lightFactor != null ? config.lightFactor : 0.85;
  const moras = [];
  for (const phrase of (query.accent_phrases || [])) {
    for (const mora of (phrase.moras || [])) {
      moras.push(mora);
    }
  }
  const groups = [];
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
    groups.push(group);
  }
  const durOf = (group) => group.reduce((sum, m) => sum + (m.consonant_length || 0) + (m.vowel_length || 0), 0);
  const durations = groups.map(durOf);
  const voiced = durations.filter((d) => d > 0);
  if (!voiced.length) {
    return query;
  }
  const mean = voiced.reduce((sum, d) => sum + d, 0) / voiced.length;
  for (let i = 0; i < groups.length; i += 1) {
    const group = groups[i];
    const duration = durations[i];
    if (duration <= 0) {
      continue;
    }
    const consonant = group.reduce((sum, m) => sum + (m.consonant_length || 0), 0);
    const vowel = group.reduce((sum, m) => sum + (m.vowel_length || 0), 0);
    if (vowel <= 0) {
      continue;
    }
    // 轻声(半音节)单独处理:目标取全句平均的 lightFactor,短而弱,不跟实词一起拉长(下限放到 0.45 让它能收够短)。
    const isLight = plan[i] && plan[i].tone === 5;
    const aim = isLight ? mean * lightFactor : duration + strength * (mean - duration);
    const floor = isLight ? 0.45 : 0.6;
    let scale = Math.max(floor, Math.min(maxScale, (aim - consonant) / vowel));
    // 句末音节再额外乘 finalBoost,拉出一点收尾的气声(轻声不在句末加长)。
    if (i === groups.length - 1 && !isLight) {
      scale *= finalBoost;
    }
    for (const mora of group) {
      if (mora.vowel_length > 0) {
        mora.vowel_length *= scale;
      }
    }
  }
  return query;
}
//// /把各音节时长向全句平均拉平、句末轻微拉长 ////

//// 把一个音节的 mora 组重切成按 pitches 画出的多拍:前几拍用原 mora 元音(单拍音节复制凑够)、末拍复制最后元音作尾,元音总长按 len 拉伸 [@x380kkm 2026-06-15] ////
// 复韵母(好 ハオ=ha-o)各拍沿用原元音、不被抹成单元音;辅音只留在第一拍。供 drawToneContours 画升调、曲折。
function contourBeats(group, pitches, len) {
  const consonant = group.reduce((sum, m) => sum + (m.consonant_length || 0), 0);
  const vowel = group.reduce((sum, m) => sum + (m.vowel_length || 0), 0) * len;
  const bodyCount = pitches.length - 1;
  const beats = [];
  for (let i = 0; i < bodyCount; i += 1) {
    beats.push({ ...group[Math.min(i, group.length - 1)] });
  }
  beats.push({ ...beats[beats.length - 1] });
  const seg = vowel / beats.length;
  // 零声母音节(一 イ、我 ウォ)合计辅音长为 0:辅音须为 null 且辅音长也为 null,
  // 否则出现 consonant=null 配 consonant_length=0 的不一致,引擎拒绝整份 query。
  const head = group[0].consonant || null;
  for (let i = 0; i < beats.length; i += 1) {
    beats[i].vowel_length = seg;
    beats[i].consonant = i === 0 ? head : null;
    beats[i].consonant_length = (i === 0 && head) ? consonant : null;
    beats[i].pitch = pitches[i];
    if (i > 0) beats[i].text = '';
  }
  return beats;
}
//// /把一个音节的 mora 组重切成按 pitches 画出的多拍 ////

//// 给一声拉长稳住高平、给二声、三声画出多拍调型:二声拉长画"先低后抬"的升,三声拉长画 214 曲折(降到底再不完全回升),短语末三声再加长 [@x380kkm 2026-06-15] ////
// 单拍音节一拍画不出升、画不出曲折,听着像高平或没调;这里把二声、三声的音节拉长重切成多拍,按调型铺音高,保留原元音。
// 一声按呼吸组内"轻重轻重"交替处理:重位拉长稳住高平,轻位略拉长并压低音高免得抢重音。句中三声(半三声)拉长并压平到低位、撑住低压,免得太短被听成二声。四声、轻声不动。须在 applyMandarinTones、时长归一、句末送气之后调用——它重排 mora、改时长,是管线最后一步。
function drawToneContours(query, plan, config = {}) {
  const t1 = Object.assign({ lenStrong: 1.25, lenWeak: 1.05, weakDrop: 0.08 }, config.t1 || {});
  // t2.liftStart:二声前接一/二声时把起点抬高(趋平近一声,顺向同化);t2.liftPeak:后接二/三声时把峰值再抬一点(逆向异化,默认 0)。
  const t2 = Object.assign({ len: 1.2, low: -0.30, rise: 0.16, liftStart: 0.18, liftPeak: 0 }, config.t2 || {});
  const t3 = Object.assign({ lenFinal: 2.2, mid: -0.20, bottom: -0.68, top: 0.05, lenLow: 1.5, lowDepth: -0.55 }, config.t3 || {});
  const all = [];
  for (const phrase of (query.accent_phrases || [])) {
    for (const mora of (phrase.moras || [])) {
      if (mora.pitch > 0) all.push(mora.pitch);
    }
  }
  if (!all.length) {
    return query;
  }
  const base = all.reduce((sum, p) => sum + p, 0) / all.length;
  let index = 0;
  let covered = 0;
  let group = [];
  let posInGroup = -1;
  for (const phrase of (query.accent_phrases || [])) {
    const out = [];
    for (const mora of phrase.moras) {
      group.push(mora);
      covered += (mora.text || '').length || 1;
      if (index < plan.length && covered >= (plan[index].kana || '').length) {
        const tone = plan[index].tone;
        const phraseFinal = (index === plan.length - 1) || (plan[index + 1] && plan[index + 1].groupStart);
        // 前邻、后邻(变调后)声调,供二声升高判定:组首处不跨停顿组取前邻,句末不取后邻。
        const prevTone = plan[index].groupStart ? null : (plan[index - 1] && plan[index - 1].tone);
        const nextTone = phraseFinal ? null : (plan[index + 1] && plan[index + 1].tone);
        // 呼吸组内按"轻重轻重"交替:组首音节为轻(偶数位),其后逢奇数位为重。轻声跳过(本就轻短)。
        posInGroup = plan[index].groupStart ? 0 : posInGroup + 1;
        const strong = (posInGroup % 2) === 1;
        if (tone === 1) {
          // 一声是高平。重位拉长稳住高平,轻位只略拉长且把音高压低一点,免得单拍高音变成全句最突出的重音(吃听成赤是太短,过长又会抢重音)。
          const factor = strong ? t1.lenStrong : t1.lenWeak;
          for (const g of group) {
            if (g.vowel_length > 0) g.vowel_length *= factor;
            if (!strong && g.pitch > 0) g.pitch -= t1.weakDrop;
            out.push(g);
          }
        } else if (tone === 2) {
          // 二声升高:前接一/二声时抬高起点(趋平近一声);后接二/三声时再抬一点峰值。否则维持原"先低后抬"。
          const lo = (prevTone === 1 || prevTone === 2) ? t2.low + t2.liftStart : t2.low;
          const hi = t2.rise + ((nextTone === 2 || nextTone === 3) ? t2.liftPeak : 0);
          for (const beat of contourBeats(group, [base + lo, base + lo, base + hi], t2.len)) out.push(beat);
        } else if (tone === 3 && phraseFinal) {
          // 只有短语末/句末的三声画完整 214 曲折;句中三声保持半三声(低、不回升,留给 applyMandarinTones 铺的低平),否则回升会听成二声「尼」。
          for (const beat of contourBeats(group, [base + t3.mid, base + t3.bottom, base + t3.top], t3.lenFinal)) out.push(beat);
        } else if (tone === 3) {
          // 句中三声是半三声(低平):低压时间太短会被听成二声(古听成鼓)。这里拉长把低压撑住,并压平到低位、不上飘。
          for (const g of group) {
            if (g.vowel_length > 0) g.vowel_length *= t3.lenLow;
            if (g.pitch > 0) g.pitch = base + t3.lowDepth;
            out.push(g);
          }
        } else {
          for (const g of group) out.push(g);
        }
        index += 1;
        covered = 0;
        group = [];
      }
    }
    for (const g of group) out.push(g);
    group = [];
    phrase.moras = out;
  }
  return query;
}
//// /给一声拉长稳住高平、给二声、三声画出多拍调型 ////

//// 按 plan 把 query 里的所有 mora 切回各音节,返回每个音节对应的 mora 数组 [@x380kkm 2026-06-15] ////
// 多个韵律步骤都要按音节(而非 mora)操作;这里统一用 plan 的片假名长度累计法分组。须在 drawToneContours 之前用(那步重排 mora 会打乱分组)。
function groupMorasByPlan(query, plan) {
  const moras = [];
  for (const phrase of (query.accent_phrases || [])) {
    for (const mora of (phrase.moras || [])) moras.push(mora);
  }
  const groups = [];
  let index = 0;
  for (let si = 0; si < plan.length; si += 1) {
    const target = (plan[si].kana || '').length;
    const group = [];
    let covered = 0;
    while (index < moras.length && covered < target) {
      covered += (moras[index].text || '').length || 1;
      group.push(moras[index]);
      index += 1;
    }
    groups.push(group);
  }
  return groups;
}
//// /按 plan 把 query 里的所有 mora 切回各音节 ////

//// 把单元音补拍那一拍按 factor 缩短:补拍是无声母、且元音与前一 mora 相同的那个 mora [@x380kkm 2026-06-15] ////
// 单元音补拍补出的第二拍整拍太长,会拖慢整句、字间显空;这里只把那一拍压短,不动正常元音与复韵母。
function shortenElongationPad(query, config = {}) {
  const factor = config.padShorten != null ? config.padShorten : 0.5;
  for (const phrase of (query.accent_phrases || [])) {
    const moras = phrase.moras || [];
    for (let i = 1; i < moras.length; i += 1) {
      const cur = moras[i];
      const prev = moras[i - 1];
      if (!cur.consonant_length && cur.vowel && cur.vowel === prev.vowel && cur.vowel_length > 0) {
        cur.vowel_length *= factor;
      }
    }
  }
  return query;
}
//// /把单元音补拍那一拍按 factor 缩短 ////

//// 把停顿(逗号、句号)前的实词音节延长一点:延长该音节首个有声 mora、把发音本身撑住 [@x380kkm 2026-06-15] ////
// 停顿前不延长会显得字一刀切断;延长首拍(发音本身)比延长尾拍(收尾减弱)更自然。轻声不在此列,交给 sustainFinalNeutral。
function extendPrePausal(query, plan, config = {}) {
  const factor = config.prePausalExtend != null ? config.prePausalExtend : 1.6;
  const groups = groupMorasByPlan(query, plan);
  for (let si = 0; si < plan.length; si += 1) {
    const phraseFinal = (si === plan.length - 1) || (plan[si + 1] && plan[si + 1].groupStart);
    if (!phraseFinal || plan[si].tone === 5) continue;
    const voiced = groups[si].filter((m) => m.vowel_length > 0);
    if (voiced.length) voiced[0].vowel_length *= factor;
  }
  return query;
}
//// /把停顿前的实词音节延长一点 ////

//// 句末轻声取消对自身的弱化:若最后一个音节是轻声(tone 5),把它的元音撑住延续到停顿 [@x380kkm 2026-06-15] ////
// 句末轻声(吗、吧、的)本被时长归一压短,停顿前显得一刀切断;这里撑住它的长度,音高仍按轻声规则由前字决定、不改。音量另在合成后回拉。
function sustainFinalNeutral(query, plan, config = {}) {
  const factor = config.finalNeutralSustain != null ? config.finalNeutralSustain : 1.6;
  if (!plan.length || plan[plan.length - 1].tone !== 5) return query;
  const groups = groupMorasByPlan(query, plan);
  for (const mora of groups[plan.length - 1]) {
    if (mora.vowel_length > 0) mora.vowel_length *= factor;
  }
  return query;
}
//// /句末轻声取消对自身的弱化 ////

//// 整句下倾:把全句有声拍的 pitch 按位置线性向下压一点,越往后压得越多,叠在四声之上 [@x380kkm 2026-06-16] ////
// 普通话(及多数语言)一句话从头到尾基频整体缓慢走低,叫下倾(declination)。原中文路径没有这一项,整句听起来偏平、缺收束感。
// 这里在画好四声之后,对扁平化的全句有声拍加一道线性下压:首拍不动,末拍压 drop,中间按位置比例插值。
// drop 随句长增长但有上限(declMax),短句压得少、长句压到上限就不再加深,免得长句末尾被拖到过低。
// 下倾与句调分工:下倾管整句的缓慢走低,句调(applySentenceIntonation)只管句末一小段的升或降,两者叠加。问句的句末上扬由句调负责抵消末段的下压。
function applyDeclination(query, plan, config = {}) {
  const declSlope = config.declSlope != null ? config.declSlope : 0.03;
  const declMax = config.declMax != null ? config.declMax : 0.30;
  const voiced = [];
  for (const phrase of (query.accent_phrases || [])) {
    for (const mora of (phrase.moras || [])) {
      if (mora.pitch > 0) voiced.push(mora);
    }
  }
  if (voiced.length < 2) return query;
  const drop = Math.min(declMax, declSlope * (voiced.length - 1));
  const clamp = (value) => Math.max(4.8, Math.min(6.6, value));
  for (let i = 0; i < voiced.length; i += 1) {
    const pos = i / (voiced.length - 1);
    voiced[i].pitch = clamp(voiced[i].pitch - drop * pos);
  }
  return query;
}
//// /整句下倾 ////

//// 按句类型铺句调:是非问句末区域上扬、陈述与特指问句末压低,只动整句最后一小段的 pitch、骑在四声之上 [@x380kkm 2026-06-16] ////
// 语调只改整体音高(这里是句末尾段的 pitch 偏移),不重画四声曲线——四声目标已铺好,句调叠在上面。
// 是非问:句末尾段(约 ynMoras 个有声拍)按位置幂次渐强抬高,越到末抬越多(全局抬升,非单点边界调)。
// 陈述与特指问:句末最后一小段(约 fallMoras 个有声拍)再压低一档(final lowering),与疑问句末上扬成对比。感叹句暂不特殊处理。
// 末段降幅由 fallExp 控制走向:0 是整段同压一档(平降);大于 0 时降幅随位置幂次加速,末字降最多(文献说陈述句最大降幅落在最后一个音节)。
// 须在 drawToneContours 之后调用(它重排 mora);这里直接在扁平化的句末有声拍上加偏移,不依赖逐音节分组。
function applySentenceIntonation(query, plan, config = {}) {
  const ynRise = config.ynRise != null ? config.ynRise : 0.22;
  const ynMoras = config.ynMoras != null ? config.ynMoras : 6;
  const finalFall = config.finalFall != null ? config.finalFall : 0.07;
  const fallMoras = config.fallMoras != null ? config.fallMoras : 2;
  const fallExp = config.fallExp != null ? config.fallExp : 0;
  const type = (plan && plan.length) ? (plan[plan.length - 1].sentenceType || 'statement') : 'statement';
  const voiced = [];
  for (const phrase of (query.accent_phrases || [])) {
    for (const mora of (phrase.moras || [])) {
      if (mora.pitch > 0) voiced.push(mora);
    }
  }
  const clamp = (value) => Math.max(4.8, Math.min(6.6, value));
  if (type === 'ynQuestion') {
    const start = Math.max(0, voiced.length - ynMoras);
    const span = voiced.length - start;
    for (let i = start; i < voiced.length; i += 1) {
      const pos = span > 1 ? (i - start) / (span - 1) : 1;
      voiced[i].pitch = clamp(voiced[i].pitch + ynRise * Math.pow(pos, 1.5));
    }
  } else if (type === 'statement' || type === 'whQuestion') {
    const start = Math.max(0, voiced.length - fallMoras);
    const span = voiced.length - start;
    for (let i = start; i < voiced.length; i += 1) {
      // fallExp 为 0 时整段同压 finalFall;大于 0 时按位置幂次加速,末字(pos=1)压满 finalFall、之前的压得少。
      const pos = span > 1 ? (i - start) / (span - 1) : 1;
      const drop = fallExp > 0 ? finalFall * Math.pow(pos, fallExp) : finalFall;
      voiced[i].pitch = clamp(voiced[i].pitch - drop);
    }
  }
  return query;
}
//// /按句类型铺句调 ////

//// 把一份 audio_query 按中文韵律整形:铺四声、连读收停顿、拉平时长、缩补拍、停顿前延长、句末轻声撑住、句末送气字落到短语首、二三声画调型、整句下倾、按句类型铺句调 [@x380kkm 2026-06-15] ////
// 中文凑音素的整条韵律流水线,顺序固定:先铺四声音高,再合并组内短语收停顿,再拉平各音节时长匀节奏,再把单元音补拍压短,
// 再把停顿前实词延长、句末轻声撑住,再把句末送气字切到短语首送气,再给二声画升、三声画曲折(这步重排 mora)。
// 最后两步只动 pitch、骑在已铺好的四声之上:先整句下倾让全句缓慢走低,再按句类型铺句调收住句末(是非问上扬、陈述与特指问压低)。
// query 需已铺好 CHINESE_QUERY_DEFAULTS;config 透传给各步。音量回拉是合成后的 PCM 处理,不在这条流水线里。
function applyChineseProsody(query, plan, config = {}) {
  applyMandarinTones(query, plan, config);
  shapeChineseRhythm(query, config);
  sizePhrasePauses(query, plan, config);
  normalizeSyllableDurations(query, plan, config);
  shortenElongationPad(query, config);
  extendPrePausal(query, plan, config);
  sustainFinalNeutral(query, plan, config);
  splitFinalAspiratedStop(query, plan);
  drawToneContours(query, plan, config);
  applyDeclination(query, plan, config);
  applySentenceIntonation(query, plan, config);
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
  drawToneContours,
  applyDeclination,
  applySentenceIntonation,
  applyChineseProsody,
  moraCount,
  CHINESE_QUERY_DEFAULTS,
  CHINESE_VOICE_PITCH,
  chineseVoicePitch,
  INITIAL_CV,
  FINAL_KANA
};
