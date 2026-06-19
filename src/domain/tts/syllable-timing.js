// audience: internal
// # syllable-timing
// 节奏、停顿与逐字时长整形层:合并停顿组内短语、按等级定停顿长、双向拉平音节时长,按声调计划把 mora 切回音节(groupMorasByPlan),
// 再按韵母逐字微调时长(滑音介音、鼻韵尾、空韵、uo/un 韵腹、二合元音尾 [i]、儿化尾、促音、最短时长兜底、主元音占比)。
// 不变量:纯逻辑无副作用;只改 mora 的时长(consonant_length/vowel_length)与停顿,不改 pitch。

const { BARE_VOWEL_KANA, GLIDE_INITIAL_FINALS, I_OFFGLIDE_FINALS } = require('./chinese-tables');
const { moraCount } = require('./pinyin-kana');

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

//// 按 plan 的 breakAfter 给各组边界的 pause_mora 定长:逗号句号全停、顿号半停、`/` 记号半半停 [@x380kkm 2026-06-16] ////
// plan 上 breakAfter 标了每个组边界的等级(full/pph/minor),顺序与合并后 query 里带 pause_mora 的短语一一对应(停顿只在组边界出现);
// 按序取等级:逗号句号等(full)设 fullPause、顿号(pph)设 pphPause、`/` 记号(minor)设 minorPause。三档拉开,逗号比顿号停得久。须在 shapeChineseRhythm 合并之后调用。
function sizePhrasePauses(query, plan, config = {}) {
  // 停顿时长(实听定,紧凑):逗号句号全停 0.10、顿号半停 0.06、`/` 半半停 0.03。
  const fullPause = config.fullPause != null ? config.fullPause : 0.10;
  const pphPause = config.pphPause != null ? config.pphPause : 0.06;
  const minorPause = config.minorPause != null ? config.minorPause : 0.03;
  const levels = [];
  for (const p of (plan || [])) { if (p.breakAfter) levels.push(p.breakAfter); }
  let k = 0;
  for (const phrase of (query.accent_phrases || [])) {
    if (phrase.pause_mora && phrase.pause_mora.vowel_length != null) {
      const level = levels[k]; k += 1;
      phrase.pause_mora.vowel_length = level === 'minor' ? minorPause : (level === 'pph' ? pphPause : fullPause);
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

//// 把滑音字的介音那一拍压短,韵腹那一拍补回:介音是过渡性滑音、不该和韵腹等长,压短后两拍连成一个滑音而非两个分离元音 [@x380kkm 2026-06-16] ////
// 零声母带介音的字(爷 イエ、烟 イエン、约 ユエ)介音 イ/ウ/ユ 写成整拍,与韵腹等长,听着是两个分离的元音、不连贯。
// 这里把介音那拍的时长压到 glideMedialRatio(默认留四成),省下的并给韵腹,总长不变;实听比写成单拍小写假名(イェ)更像普通话——普通话 ye 是饱满双元音,单拍太短。
// 只认「首拍是 イ/ウ/ユ、次拍是完整元音韵腹」的结构,排除 ユイ(那是 ü[y] 单韵腹的近似、不是介音加韵腹);ウォ/ウェ 这类小写假名本就单拍滑音、不在此列。
// 二声、三声音节随后会被 drawToneContours 的 contourBeats 重切成等长多拍(介音自然落到约三分之一),故这步主要对一声、四声、轻声的滑音字生效;对二三声做了也不冲突(总长不变)。须在 drawToneContours 之前调用。
function tightenGlideMedial(query, plan, config = {}) {
  const ratio = config.glideMedialRatio != null ? config.glideMedialRatio : 0.4;
  const VOWEL = new Set(['ア', 'イ', 'ウ', 'エ', 'オ']);
  const MEDIAL_HEAD = new Set(['イ', 'ウ', 'ユ']);
  for (const group of groupMorasByPlan(query, plan)) {
    if (group.length < 2) continue;
    const head = group[0].text || '';
    const next = group[1].text || '';
    if (!MEDIAL_HEAD.has(head) || !VOWEL.has(next)) continue;
    if (head === 'ユ' && next === 'イ') continue; // ü=ユイ 是单韵腹,不压
    const v = group[0].vowel_length || 0;
    if (v <= 0) continue;
    const cut = v * (1 - ratio);
    group[0].vowel_length = v - cut;
    if (group[1].vowel_length > 0) group[1].vowel_length += cut;
  }
  return query;
}
//// /把滑音字的介音那一拍压短 ////

//// 把每个字的有效时长收进区间:超上限的压短元音、低于下限的抬长元音,区间内不动 [@x380kkm 2026-06-16] ////
// 实测各字时长忽长忽短(烟 609 毫秒拖、张 220 毫秒赶),听着不匀。这里给单字有效时长设上下限,只夹出界的、不动均衡的。
// 须在 drawToneContours 之前调用:那步把元音乘声调拉长系数(只乘元音、辅音不动),故有效时长=辅音+元音×系数;这里按同一套系数(读同一份 config.t1/t2/t3)反推,夹完再交给它画。
// 系数:一声重位 lenStrong、轻位 lenWeak、二声 len、句末三声 lenFinal、句中三声 lenLow,与 drawToneContours 一致。speedScale 把 mora 时长整体压缩,故区间按它折算。
function fitSyllableDuration(query, plan, config = {}) {
  // 下限 180:太短字粘连、太快显赶;180 折中,既不糊也不拖。
  const minMs = config.minDurMs != null ? config.minDurMs : 180;
  const maxMs = config.maxDurMs != null ? config.maxDurMs : 390;
  const t1 = Object.assign({ lenStrong: 1.25, lenWeak: 1.05 }, config.t1 || {});
  const t2 = Object.assign({ len: 1.2 }, config.t2 || {});
  const t3 = Object.assign({ lenFinal: 1.0, lenLow: 1.0 }, config.t3 || {});
  const speed = query.speedScale || 1;
  const groups = groupMorasByPlan(query, plan);
  let posInGroup = -1;
  for (let si = 0; si < plan.length; si += 1) {
    const group = groups[si] || [];
    const tone = plan[si].tone;
    const phraseFinal = (si === plan.length - 1) || (plan[si + 1] && plan[si + 1].groupStart);
    posInGroup = plan[si].groupStart ? 0 : posInGroup + 1;
    const strong = (posInGroup % 2) === 1;
    let factor = 1;
    if (tone === 1) factor = strong ? t1.lenStrong : t1.lenWeak;
    else if (tone === 2) factor = t2.len;
    else if (tone === 3 && phraseFinal) factor = t3.lenFinal;
    else if (tone === 3) factor = t3.lenLow;
    const cons = group.reduce((sum, m) => sum + (m.consonant_length || 0), 0);
    const vow = group.reduce((sum, m) => sum + (m.vowel_length || 0), 0);
    if (vow <= 0) continue;
    const effMs = (cons + vow * factor) / speed * 1000;
    const tgtMs = effMs > maxMs ? maxMs : (effMs < minMs ? minMs : 0);
    if (!tgtMs) continue;
    // 调元音让有效时长落到目标:cons + newVow×factor = tgtMs×speed,解出 newVow。
    const newVow = Math.max(0.01, (tgtMs * speed / 1000 - cons) / factor);
    const scale = newVow / vow;
    for (const m of group) { if (m.vowel_length > 0) m.vowel_length *= scale; }
  }
  return query;
}
//// /把每个字的有效时长收进区间 ////

//// 按韵尾调鼻音占比区分 -n/-ng:前鼻韵尾压短鼻音与滑尾、时间给主元音(字更清);后鼻韵尾拖长鼻音(in/ing 靠此分),整字总长不变 [@x380kkm 2026-06-17] ////
// 经核验研究:日语 ン 是单一音位、词末无法编码 [n]/[ŋ] 部位区别,真正线索在元音音质与鼻音时长。
// 据此:-n 字(安 アエン、奔 エン)把鼻音 ン 与滑尾(アエン 的 エ)压短,时间挪给主元音(第一个元音,安里是 ア),元音更出、字更清;-ng 字(英 イン)把鼻音拖长、与 -n 拉开。总长不变、只改占比。
// 须在 fitSyllableDuration 之后、drawToneContours 之前调用。画调型会重排二、三声的 mora,故此步主要对一声、四声、轻声的鼻韵母生效(安是一声,正合)。
function adjustNasalCoda(query, plan, config = {}) {
  if (config.nasalCoda === false) return query;
  const offShorten = config.offGlideShorten != null ? config.offGlideShorten : 0.7; // 滑尾压短比例(安的 エ、肮的 オ 压短、连下去不分裂)
  // 鼻音都从主元音取时间、变长(让带鼻音的字与不带鼻音的「啊」拉开对比、a 短 n 长);-ng 取得更多、比 -n 更长,以此再区分 in/ing。
  const nNasalLen = config.nCodaLengthen != null ? config.nCodaLengthen : 0.25;  // -n 鼻音取主元音的比例(中等、可闻,安≠啊)
  const ngNasalLen = config.ngCodaLengthen != null ? config.ngCodaLengthen : 0.5; // -ng 鼻音取主元音的比例(更长、与 -n 拉开)
  const groups = groupMorasByPlan(query, plan);
  for (let s = 0; s < plan.length; s += 1) {
    const coda = plan[s] && plan[s].nasalCoda;
    if (!coda) continue;
    const g = groups[s] || [];
    let nasalIdx = -1;
    for (let i = g.length - 1; i >= 0; i -= 1) { if (g[i].text === 'ン') { nasalIdx = i; break; } }
    if (nasalIdx <= 0) continue; // 没鼻音 mora 或鼻音在首位,跳过
    // 主元音定位:一般是紧挨鼻音的元音;但 アエン/アオン 的紧挨元音是滑尾 エ/オ,主元音是开头的 ア。
    // 靠「首拍是 ア 且鼻音前还有别的元音」识别这种「主元音 + 滑尾 + 鼻音」结构;否则主元音取紧挨鼻音那拍(イアン 的 ア、エン 的 エ、烟 イエン 的 エ)。
    const hasOffglide = nasalIdx >= 2 && g[0].text === 'ア';
    const mainVowel = hasOffglide ? g[0] : g[nasalIdx - 1];
    // 滑尾压短(アエン 的 エ、アオン 的 オ)、给主元音 ア,让 a 连下去、不分裂、平滑;只在「主元音 + 滑尾」结构上做,不动 イアン 这类介音字。
    if (hasOffglide) {
      for (let i = 1; i < nasalIdx; i += 1) {
        const om = g[i];
        if (om.vowel_length > 0) { const cut = om.vowel_length * offShorten; om.vowel_length -= cut; mainVowel.vowel_length = (mainVowel.vowel_length || 0) + cut; }
      }
    }
    // 鼻音从主元音取时间、变长:主元音短一点、鼻音长一点(a 短 n 长,带鼻音的字不再像「啊」);-ng 取得更多、比 -n 更长。
    const lenFrac = coda === 'ng' ? ngNasalLen : nNasalLen;
    if (mainVowel.vowel_length > 0) {
      const cut = mainVowel.vowel_length * lenFrac;
      mainVowel.vowel_length -= cut;
      g[nasalIdx].vowel_length = (g[nasalIdx].vowel_length || 0) + cut;
    }
  }
  return query;
}
//// /按韵尾调鼻音占比区分 -n/-ng ////

//// 空韵(舌尖元音)近似:把声母擦音段按比例拉长、元音随之轻微拉长(不压)、音高小抬,让 zi/zhi/shi 等离开前 [i]、不像 ji/xi [@x380kkm 2026-06-17] ////
// 空韵的 i 是成音节的舌尖擦音(资 [z̩]、知 [ʐ̩]),本质是「把声母擦音拖成韵核」。日语片假名只能拼出带前 [i] 的 ジ/シ 或 [u] 的 ス/ズ/ツ,故靠时长与音高近似:
// 声母辅音段按比例拉长(占比抬上去、擦音更出),整字只轻微变长——靠比例不靠给声母硬加绝对时长;元音随轻微放慢拉长一点、绝不压短;音高小幅抬升。
// 两类拉长比例不同:舌尖后(知/师,ジ/シ 基)温和 ×1.3——过大会把塞擦/送气顶出来、zhi 滑向 chi/qi;舌尖前(资/词/思,ス/ズ/ツ 基)更大 ×2.5——把 [s]/[ts] 拖成成音节核、与 苏/租/粗 靠擦音时长区分。
// r 的卷舌空韵(日)不在 plan[s].emptyRhyme 内、此步不动。须在画调型之后调用:按 mora.syl 标签定位空韵音节(画调型重排二三声 mora 后标签仍在),音高抬升叠在画好的调型之上。config.emptyRhyme 为 false 可整体关闭。
function apicalizeEmptyRhyme(query, plan, config = {}) {
  if (config.emptyRhyme === false) return query;
  // 舌尖后空韵(知/师,用 ジ/シ 基)拉长温和(主观确认 ×1.3,过大会把塞擦顶出来、滑向 chi/qi)。
  const cMulRetro = config.apicalConsonant != null ? config.apicalConsonant : 1.3;
  // 舌尖前空韵(资/词/思,用 ス/ズ/ツ 基)需拉得更多,把 [s]/[ts] 擦音拖成成音节核、[u] 淡出,与 苏/租/粗 拉开(主观确认 ×2.5)。
  const cMulDental = config.apicalConsonantDental != null ? config.apicalConsonantDental : 2.5;
  // 舌尖前空韵擦音封顶:×2.5 无上限会把四的 [s] 拉到 304ms,与前字(兮)的元音尾黏成一大片高频咝声、无元音断点。封顶后空韵仍保得住、又不糊。有效毫秒。
  const dentalCapMs = config.apicalDentalCapMs != null ? config.apicalDentalCapMs : 100;
  const dentalCap = dentalCapMs / 1000 * (query.speedScale || 1);
  const vMul = config.apicalVowel != null ? config.apicalVowel : 1.05; // 元音随轻微放慢拉长的比例(>1,不压)
  const pAdd = config.apicalRaise != null ? config.apicalRaise : 0.10; // 音高抬升量(对数 Hz)
  const clamp = (v) => Math.max(4.8, Math.min(6.6, v));
  for (const phrase of (query.accent_phrases || [])) {
    for (const m of (phrase.moras || [])) {
      const s = m.syl;
      const row = (s != null && plan[s]) ? plan[s].emptyRhyme : null;
      if (!row) continue;
      const cMul = row === 'dental' ? cMulDental : cMulRetro;
      if (m.consonant_length != null) {
        m.consonant_length *= cMul; // 只放大有声母那一拍的辅音段
        if (row === 'dental' && m.consonant_length > dentalCap) m.consonant_length = dentalCap; // 舌尖前空韵擦音封顶
      }
      if (m.vowel_length > 0) m.vowel_length *= vMul;
      if (m.pitch > 0) m.pitch = clamp(m.pitch + pAdd);
    }
  }
  return query;
}
//// /空韵(舌尖元音)近似 ////

//// 后鼻韵尾 -ng 把元音撑出身子:画调型把单韵腹(城 チョ)切成几拍、每拍过短,长鼻音又盖住元音,听着没劲;按比例拉长 -ng 字的元音拍(非 ン),元音不压、整字略长 [@x380kkm 2026-06-17] ////
// 只对 -ng(plan[s].nasalCoda 为 ng)做:-n 字要保持「a 短 n 长」(安不像啊),不在此列。按 mora.syl 定位,拉长该字非 ン 的有声拍。须在画调型之后调用(标签仍在)。
function bolsterNgVowel(query, plan, config = {}) {
  const vMul = config.ngVowelBody != null ? config.ngVowelBody : 1.5;
  if (vMul === 1) return query;
  for (const phrase of (query.accent_phrases || [])) {
    for (const m of (phrase.moras || [])) {
      const s = m.syl;
      if (s == null || !(plan[s] && plan[s].nasalCoda === 'ng')) continue;
      if (m.text !== 'ン' && m.vowel_length > 0) m.vowel_length *= vMul;
    }
  }
  return query;
}
//// /后鼻韵尾 -ng 把元音撑出身子 ////

//// uo 介音字(国/锅/果)按比例分配 u 介音与 o 韵腹:画调型常把 [u] 介音压没、整字听成「go」又太短;按总长重分,u 占固定比例、o 占其余、整字略增 [@x380kkm 2026-06-17] ////
// 国 guo=グ(u)+オ(o):主观确认 u 介音占整字时长 0.37、整字总长 ×1.3 时,既清楚是「guo」又不过长。
// 按 mora.syl 定位 plan[s].final 为 uo 的字,取其有声拍:首拍是 [u] 介音、其余是 [o] 韵腹,按总长重新分配。须在画调型之后调用(标签仍在)。config.uoGlide 为 false 可关闭。
function balanceUoGlide(query, plan, config = {}) {
  if (config.uoGlide === false) return query;
  const uShare = config.uoGlideShare != null ? config.uoGlideShare : 0.37;
  const total = config.uoTotal != null ? config.uoTotal : 1.3;
  const groups = {};
  for (const phrase of (query.accent_phrases || [])) {
    for (const m of (phrase.moras || [])) {
      if (m.syl == null || !(plan[m.syl] && plan[m.syl].final === 'uo') || !(m.vowel_length > 0)) continue;
      (groups[m.syl] = groups[m.syl] || []).push(m);
    }
  }
  for (const s in groups) {
    const g = groups[s];
    if (g.length < 2 || g[0].vowel !== 'u') continue; // 需有独立的 [u] 介音拍与其后的 [o] 韵腹
    const nuc = g.slice(1);
    const t0 = g.reduce((a, m) => a + m.vowel_length, 0);
    const n0 = nuc.reduce((a, m) => a + m.vowel_length, 0);
    if (!(n0 > 0)) continue;
    const target = t0 * total;
    g[0].vowel_length = target * uShare;
    const rest = target * (1 - uShare);
    for (const m of nuc) m.vowel_length = rest * (m.vowel_length / n0); // o 韵腹按原占比分掉其余
  }
  return query;
}
//// /uo 介音字按比例分配 u 介音与 o 韵腹 ////

//// 撑长 -un/-uen 的 u 韵腹:u 是这俩韵母的韵腹,却被 adjustNasalCoda 当一般 -n 削去四分之一、又无补拍,听着偏短;按 mora.syl 定位、拉长该字非 ン 的有声拍 [@x380kkm 2026-06-18] ////
// 损 sun=スン、春 chun=チュン:u 单拍在前、ン 在后。-un/-uen 的 u 是主元音不是介音,不该按「a 短 n 长」压短(那是给 安≠啊 用)。
// 只对 plan[s].final 为 un/uen 的字、拉长其非 ン 有声拍(主观确认 ×1.4,u 站得住又不拖)。须在画调型之后调用(标签仍在)。config.unVowel 为 false 可关闭。
function bolsterUnVowel(query, plan, config = {}) {
  if (config.unVowel === false) return query;
  const vMul = config.unVowelBody != null ? config.unVowelBody : 1.4;
  if (vMul === 1) return query;
  for (const phrase of (query.accent_phrases || [])) {
    for (const m of (phrase.moras || [])) {
      const s = m.syl;
      if (s == null || !(plan[s] && (plan[s].final === 'un' || plan[s].final === 'uen'))) continue;
      if (m.text !== 'ン' && m.vowel_length > 0) m.vowel_length *= vMul;
    }
  }
  return query;
}
//// /撑长 -un/-uen 的 u 韵腹 ////

//// 给促音 ッ(切分标记)按级定闭合时长:词边界极短、连读次之、`/` 韵律短语边界较长——促音大小即句内切分强度 [@x380kkm 2026-06-18] ////
// 促音在 query 里是一个 vowel='cl' 的闭合 mora,其 vowel_length 即闭合时长。按 mora.syl 找到来源音节 plan[s].sokuon 的等级、定长。
// word(韵律词边界)极短、只分词不打断连读;liaison(同源连读)掐断滑音;minor(`/` 韵律短语边界)句内切分、较长但仍非静音(静音只留给真正的标点)。须在画调型之后调用(标签仍在)。config.sizeSokuon 为 false 可关闭。
function sizeSokuon(query, plan, config = {}) {
  if (config.sizeSokuon === false) return query;
  const wordLen = config.sokuonWord != null ? config.sokuonWord : 0.012;
  const liaisonLen = config.sokuonLiaison != null ? config.sokuonLiaison : 0.02;
  const minorLen = config.sokuonMinor != null ? config.sokuonMinor : 0.05;
  for (const phrase of (query.accent_phrases || [])) {
    for (const m of (phrase.moras || [])) {
      if (m.vowel !== 'cl') continue;
      const s = m.syl;
      const level = (s != null && plan[s]) ? plan[s].sokuon : null;
      if (level === 'minor') m.vowel_length = minorLen;
      else if (level === 'liaison') m.vowel_length = liaisonLen;
      else if (level === 'word') m.vowel_length = wordLen;
    }
  }
  return query;
}
//// /给促音 ッ 按级定闭合时长 ////

//// er 韵收尾:把儿/二/而(アル)的 ル 那一拍压短成 r 色尾音,不让它念成独立的「鲁」音节 [@x380kkm 2026-06-17] ////
// er 韵(儿化的 [aɚ])片假名拼成 アル,其中 ル 是完整音节 [ɾu]、听着像多出一个「鲁」(二听成二鲁)。
// 只把 ル 那一拍 vowel_length 压短(主观确认 ×0.3:既不再是「鲁」、又仍听得见卷舌),元音 ア 不动——还给 ア 时间会把元音撑太长、反吞掉卷舌(实听确认)。
// 按 mora.syl 标签只压 plan[s].erFinal 为真的字的 ル,绝不碰 如/鲁/路(也是 ル、但非 er)。须在画调型之后调用(标签仍在)。config.erhua 为 false 可关闭。
// 多音节儿化(花儿、一会儿)的「儿」会与前字连读成 fur 类,根因是 アル 多出一个 ア 元音、需结构性并字,不在本步;本步只管单字 er 与儿尾不成「鲁」。
function tightenErhuaTail(query, plan, config = {}) {
  if (config.erhua === false) return query;
  const ruScale = config.erTailShorten != null ? config.erTailShorten : 0.3;
  for (const phrase of (query.accent_phrases || [])) {
    for (const m of (phrase.moras || [])) {
      if (m.text !== 'ル') continue;
      const s = m.syl;
      if (s == null || !(plan[s] && plan[s].erFinal)) continue;
      if (m.vowel_length > 0) m.vowel_length *= ruScale;
    }
  }
  return query;
}
//// /er 韵收尾 ////

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

//// 把零声母 i 韵(益)的 ユイ 两拍按比例分:起音 ユ 占少、韵腹 イ 占多,使其听成带起音的单字而非两拍「yu-i」 [@x380kkm 2026-06-19] ////
// 益改用 ユイ 后是两拍(ユ 起音、イ 韵腹),不分配时 ユ 偏长、听着像「yu-i」两个音。
// 这里按 mora.syl 找 plan[s].bareYi 为真的字,把它两拍的有声时长总和按比例重切:ユ 占 yuShare(默认 0.12、约一成,实测 ≈31ms)、其余归韵腹 イ(实测 ≈224ms)。
// 须在所有改 vowel_length 的步(归一、缩补拍、停顿前延长、贴合区间、画调型重排等)之后调用,拿到定稿总长再切,否则比例被后续步骤抹平。config.bareYiGlide 为 false 可关闭。
function distributeBareYiGlide(query, plan, config = {}) {
  if (config.bareYiGlide === false) return query;
  const yuShare = config.bareYiGlideShare != null ? config.bareYiGlideShare : 0.12;
  // 韵腹 イ 封顶:句末延长会把这字撑到上限,长度重分配又几乎全堆到单个稳态 イ 上,拖成长音(衣 297ms);给 イ 设上限,省下的不堆。
  const maxNuc = (config.bareYiMaxNucleusMs != null ? config.bareYiMaxNucleusMs : 200) / 1000 * (query.speedScale || 1);
  const groups = {};
  for (const phrase of (query.accent_phrases || [])) {
    for (const m of (phrase.moras || [])) {
      if (m.syl == null || !(plan[m.syl] && plan[m.syl].bareYi) || !(m.vowel_length > 0)) continue;
      (groups[m.syl] = groups[m.syl] || []).push(m);
    }
  }
  for (const s in groups) {
    const g = groups[s];
    if (g.length < 2) continue; // 需起音 ユ 加韵腹 イ 两拍才分配
    const tot = g.reduce((a, m) => a + m.vowel_length, 0);
    g[0].vowel_length = tot * yuShare; // 起音 ユ:短
    const rest = g.slice(1);
    const restSum = rest.reduce((a, m) => a + m.vowel_length, 0);
    const nucTotal = Math.min(tot * (1 - yuShare), maxNuc); // 韵腹总长封顶
    for (const m of rest) {
      m.vowel_length = restSum > 0 ? nucTotal * (m.vowel_length / restSum) : nucTotal / rest.length;
    }
  }
  return query;
}
//// /把零声母 i 韵的 ユイ 两拍按比例分 ////

//// 把 ai/ei 类二合元音的尾 [i] 收成极短滑音:尾 [i] 压到 glideMs、省下的时长还给主元音首拍,免得尾 [i] 被声调拉长听成独立的「一」 [@x380kkm 2026-06-19] ////
// ai(来 ライ)、ei(美 メイ)等二合元音的尾 [i] 是滑音、本应短促;声调画调型会复制 mora,把尾 [i] 撑成整拍甚至两拍,听成独立音节「一」(尔来二十听成而来一二十)。
// 这里对 final 在 I_OFFGLIDE_FINALS 的字,把同一字内首拍之后的 [i] 拍压到 glideMs(默认 30ms 有效),省下的时长加回首拍主元音、但主元音封顶 mainCapMs;总字长可略缩,不会把主元音撑成超长单元音(唯 e 被堆到 320ms、听成两段)。须在画调型(它复制 mora)之后调用。config.offGlide 为 false 关闭。
function shortenDiphthongOffGlide(query, plan, config = {}) {
  if (config.offGlide === false) return query;
  const glideMs = config.offGlideMs != null ? config.offGlideMs : 30;
  const cap = (glideMs / 1000) * (query.speedScale || 1);
  const mainCap = (config.offGlideMainCapMs != null ? config.offGlideMainCapMs : 200) / 1000 * (query.speedScale || 1);
  const groups = {};
  for (const phrase of (query.accent_phrases || [])) {
    for (const m of (phrase.moras || [])) {
      if (m.syl == null || !(m.vowel_length > 0)) continue;
      (groups[m.syl] = groups[m.syl] || []).push(m);
    }
  }
  for (const s in groups) {
    if (!I_OFFGLIDE_FINALS.has(plan[s] && plan[s].final)) continue;
    const g = groups[s];
    let freed = 0;
    for (let i = 1; i < g.length; i += 1) {
      if (g[i].vowel === 'i' && g[i].vowel_length > cap) { freed += g[i].vowel_length - cap; g[i].vowel_length = cap; }
    }
    // 省下的还给首拍主元音,但主元音封顶:超过 mainCap 的不再堆上去(否则唯的 e 被撑到 320ms),整字略缩。
    if (freed > 0) g[0].vowel_length = Math.min(g[0].vowel_length + freed, Math.max(g[0].vowel_length, mainCap));
  }
  return query;
}

//// 给零声母介音字的首拍介音保底:零声母 i/u 介音(又 iou、王 uang)靠介音自己起音,过短会塌成纯元音(又→欧),把介音补到下限、从同字主元音借时长 [@x380kkm 2026-06-19] ////
// 又(yòu)拼成 イオ、零声母,首拍 イ 是 [j] 起音;实测它只有 26ms、听不出 y,「又」塌成「欧」。这里对 plan[s].zeroGlide 的字,首拍介音短于下限时补到下限,从同字最长元音拍借时长(总长不变)。须在画调型之后调用。config.glideFloor 为 false 关闭、config.glideFloorMs 调下限。
function floorGlideOnset(query, plan, config = {}) {
  if (config.glideFloor === false) return query;
  const floor = (config.glideFloorMs != null ? config.glideFloorMs : 55) / 1000 * (query.speedScale || 1);
  const groups = {};
  for (const phrase of (query.accent_phrases || [])) {
    for (const m of (phrase.moras || [])) {
      if (m.syl == null || !(m.vowel_length > 0)) continue;
      (groups[m.syl] = groups[m.syl] || []).push(m);
    }
  }
  for (const s in groups) {
    if (!(plan[s] && plan[s].zeroGlide)) continue;
    const g = groups[s];
    const head = g[0];
    if (head.vowel_length >= floor || g.length < 2) continue;
    const need = floor - head.vowel_length;
    // 从最长的非首拍借,够借才补,不把被借的拍压到比首拍还短。
    const donor = g.slice(1).reduce((a, m) => (m.vowel_length > a.vowel_length ? m : a), g[1]);
    const give = Math.min(need, donor.vowel_length - floor);
    if (give > 0) { head.vowel_length += give; donor.vowel_length -= give; }
  }
  return query;
}
//// /给零声母介音字的首拍介音保底 ////
//// /把 ai/ei 类二合元音的尾 [i] 收成极短滑音 ////

//// 给短语内非末拍的鼻韵尾 ン 设绝对上限:压掉「接任何字都拖」的长鼻音,鼻音占比仍由 adjustNasalCoda 管、这里只兜底封顶 [@x380kkm 2026-06-19] ////
// 带鼻韵尾的字 ン 那一拍被 adjustNasalCoda(从主元音借时间并入鼻音)与 bolsterNgVowel 做长,无封顶时整篇平均约 107ms、后鼻音可达 207ms,撑成一条满身子的长鸣,接任何后字都显拖。
// 这里在所有改鼻拍的步之后兜底:把每个短语内非末拍的 ン 的 vowel_length 封顶到 ≤ (nasalCapMs/1000)×speedScale。短语末那一拍的鼻音保留拖腔(那是韵律收尾、不是缺陷),不压。
// 默认 45ms:实测拖沓基本消除、鼻音幅度不衰减仍清楚可闻;前后鼻音的区分交给 adjustNasalCoda 的音质处理,不靠长度。config.capNasalCoda 为 false 关闭、config.nasalCapMs 调上限。
function capNasalCoda(query, plan, config = {}) {
  if (config.capNasalCoda === false) return query;
  const capMs = config.nasalCapMs != null ? config.nasalCapMs : 45;
  const cap = (capMs / 1000) * (query.speedScale || 1);
  for (const phrase of (query.accent_phrases || [])) {
    const moras = phrase.moras || [];
    for (let i = 0; i < moras.length - 1; i += 1) {
      if (moras[i].vowel === 'N' && moras[i].vowel_length > cap) moras[i].vowel_length = cap;
    }
  }
  return query;
}
//// /给短语内非末拍的鼻韵尾 ン 设绝对上限 ////

//// 流水线末尾的最短时长兜底:fitSyllableDuration 之后的步(封顶鼻尾、定促音时长等)会再砍短,这里把仍低于下限的字补回 [@x380kkm 2026-06-19] ////
// fitSyllableDuration 在中段把字撑到下限,但其后的 capNasalCoda 砍鼻尾、sizeSokuon 定促音等会把字再砍到下限以下(本/躬/耕 掉到约 170ms)。
// 这里在最末尾按定稿时长再兜一次:某字总有效时长低于 minMs 时,把缺口加到它的主元音拍(有声、非鼻尾 N、非促音 cl),按现有占比分摊;不补鼻音、不补促音,故鼻尾仍短、字也不短。config.enforceMinDur 为 false 关闭。
function enforceMinDuration(query, plan, config = {}) {
  if (config.enforceMinDur === false) return query;
  const minMs = config.minDurMs != null ? config.minDurMs : 180;
  const minLen = (minMs / 1000) * (query.speedScale || 1);
  const groups = {};
  for (const phrase of (query.accent_phrases || [])) {
    for (const m of (phrase.moras || [])) { if (m.syl != null) (groups[m.syl] = groups[m.syl] || []).push(m); }
  }
  for (const s in groups) {
    const g = groups[s];
    const total = g.reduce((sum, m) => sum + (m.consonant_length || 0) + (m.vowel_length || 0), 0);
    if (total >= minLen) continue;
    const nuclei = g.filter((m) => m.vowel_length > 0 && m.vowel !== 'N' && m.vowel !== 'cl' && m.vowel !== 'pau');
    if (!nuclei.length) continue;
    const deficit = minLen - total;
    const nucSum = nuclei.reduce((sum, m) => sum + m.vowel_length, 0);
    for (const m of nuclei) m.vowel_length += deficit * (m.vowel_length / nucSum);
  }
  return query;
}
//// /流水线末尾的最短时长兜底 ////

//// 保障主元音占比:每个字的主元音(最长的非鼻尾、非促音元音拍)不足音节时长的 share 时补到 share,免得被声母、鼻尾、介音、滑音挤太短 [@x380kkm 2026-06-19] ////
// 忠(ジョン)这类「声母 + ong/eng 鼻韵母」字的主元音 [o] 被声母与鼻尾两头挤、只剩约 68ms,听着发促;二合元音(来 ai)、滑音字(下 ia)的主元音也会被滑音抢时长。
// 这里给主元音设占比下限:总有效时长 × share 为目标,主元音短于此就补到目标,其余拍(声母、鼻尾、促音、其它元音)等比例压缩、使整字总长不变——只调字内分配、不加长(不嵌套)。share 默认 0.4。config.mainVowelShare 为 false 关闭、config.mainVowelShareRatio 调比例。
function ensureMainVowelShare(query, plan, config = {}) {
  if (config.mainVowelShare === false) return query;
  const share = config.mainVowelShareRatio != null ? config.mainVowelShareRatio : 0.4;
  const groups = {};
  for (const phrase of (query.accent_phrases || [])) {
    for (const m of (phrase.moras || [])) { if (m.syl != null) (groups[m.syl] = groups[m.syl] || []).push(m); }
  }
  const affShare = config.affricateShareRatio != null ? config.affricateShareRatio : 0.5;
  for (const s in groups) {
    const g = groups[s];
    const total = g.reduce((sum, m) => sum + (m.consonant_length || 0) + (m.vowel_length || 0), 0);
    // 塞擦空韵字(此/次/字):成音节身子是那段塞擦,占比不足时给塞擦补到 affShare,从元音拍借时长(总长不变)。s 擦音(四/思)不在此列。
    if (plan[s] && plan[s].dentalAffricate) {
      const consM = g.find((m) => m.consonant_length > 0);
      const vows = g.filter((m) => m.vowel_length > 0);
      const target = affShare * total;
      if (consM && consM.consonant_length < target && vows.length) {
        const need = target - consM.consonant_length;
        const vSum = vows.reduce((sum, m) => sum + m.vowel_length, 0);
        if (vSum > need) { consM.consonant_length = target; for (const m of vows) m.vowel_length -= need * (m.vowel_length / vSum); }
      }
      continue;
    }
    const vowels = g.filter((m) => m.vowel_length > 0 && m.vowel !== 'N' && m.vowel !== 'cl' && m.vowel !== 'pau');
    if (!vowels.length) continue;
    // 带前介音的韵母(y 系 i 介音、w 系 u 介音):首个元音拍是介音、不算主元音,主元音从其后的韵腹里取。
    const cand = (GLIDE_INITIAL_FINALS.has(plan[s] && plan[s].final) && vowels.length > 1) ? vowels.slice(1) : vowels;
    const main = cand.reduce((a, m) => (m.vowel_length > a.vowel_length ? m : a), cand[0]);
    const target = share * total;
    if (main.vowel_length >= target) continue;
    // 主元音补到 target,其余部分(总长减主元音)等比例压到 total-target,整字总长 total 不变。
    const restOld = total - main.vowel_length;
    if (restOld <= 0) continue;
    const k = (total - target) / restOld;
    for (const m of g) {
      if (m.consonant_length != null) m.consonant_length *= k; // 保留 null:无声母的拍不能写 0,否则 query 非法
      m.vowel_length = (m === main) ? target : (m.vowel_length || 0) * k;
    }
  }
  return query;
}
//// /保障主元音占比 ////

module.exports = { flowPhrases, shapeChineseRhythm, sizePhrasePauses, splitFinalAspiratedStop, normalizeSyllableDurations, tightenGlideMedial, fitSyllableDuration, adjustNasalCoda, apicalizeEmptyRhyme, bolsterNgVowel, balanceUoGlide, bolsterUnVowel, sizeSokuon, tightenErhuaTail, shortenElongationPad, extendPrePausal, sustainFinalNeutral, distributeBareYiGlide, shortenDiphthongOffGlide, floorGlideOnset, capNasalCoda, enforceMinDuration, ensureMainVowelShare };
