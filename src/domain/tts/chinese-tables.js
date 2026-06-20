// audience: internal
// # chinese-tables
// 中文凑音素层的常量表:声母与韵母的片假名拼法、韵母分类集(送气、空韵、滑音、零声母 i/u 系等)、
// 句合成的 audio_query 推荐默认值,以及按声线 styleId 单独锚定的全局音高偏移与语速倍率表。
// 不变量:纯数据与纯查表函数,无副作用;未列出的声线音高偏移为 0、语速倍率为 1。

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
  // z/c/s + 韵母 i 是普通话舌尖前空韵(资 [z̩]、词、思),本质是把 [dz]/[ts]/[s] 擦音拖成成音节核。
  // 旧用拗音 ズィ/ツィ/スィ:小 ィ 被引擎拽向腭化的 ジ/チ/シ([dʑi/tɕi/ɕi]),把「四」听成「西」、「资」听成「机」(实听确认)。
  // 改用 ス/ズ/ツ([u] 基、非腭化),补拍随基用 ウ(见 syllableToKana),再由 apicalizeEmptyRhyme 拉长声母擦音、做出成音节舌尖音;
  // 与 苏/租/粗(本读 [u])靠擦音时长区分:空韵的擦音被拉长、[u] 淡出,实词 [u] 不拉长。
  z: { a: 'ザ', i: 'ズ', u: 'ズ', e: 'ゼ', o: 'ゾ' },
  c: { a: 'ツァ', i: 'ツ', u: 'ツ', e: 'ツェ', o: 'ツォ' },
  s: { a: 'サ', i: 'ス', u: 'ス', e: 'セ', o: 'ソ' },
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
  // -an 用 アエン:a 在 -n 前本是前移的 [a̟](偏「爱/欸」),加 エ 前滑尾让「安」更清。-ang 用 アオン:a 在 -ng 前是后移的 [ɑ],加 オ 后滑尾把后元音做出来,与 -an 前后对称。
  // 两者的滑尾(エ/オ)都由 adjustNasalCoda 压短、给主元音 a,保持平滑不分裂;-eng 用 オン 与 -en 的 エン 区分。
  an: 'アエン', en: 'エン', ang: 'アオン', eng: 'オン', ong: 'オン',
  // 纯鼻音叹词(嗯/呣):成音节鼻音,用 ウン 给一个有声的鼻音 hum(单 ン 太轻),由 parsePinyin 把 ng/n/m 都归到这里。
  ng: 'ウン',
  er: 'アル',
  // iu/iou 拼音「iu」是「iou」缩写、实读 [jou],主元音是 o(九 jiǔ=jio、有 yǒu=yo);旧记 イウ 漏了主元音 o、把九听成几(ji)。改 イオ:介音 i + 主元音 o。
  i: 'イ', ia: 'イア', ie: 'イエ', iao: 'イアオ', io: 'イオ', iu: 'イオ', iou: 'イオ',
  ian: 'イエン', in: 'イン', iang: 'イアン', ing: 'イン', iong: 'イオン',
  u: 'ウ', ua: 'ウア', uo: 'ウオ', uai: 'ウアイ', ui: 'ウイ', uei: 'ウイ',
  uan: 'ウアン', un: 'ウン', uen: 'ウン', uang: 'ウアン', ueng: 'ウオン',
  // ü[y] 是前高圆唇,日语只有后高的 ウ;单用 ユ 接腭化声母会拼成 チュ[tɕu](去听成 chu)。
  // 改用 ユイ:在 ュ 后补个前元音 イ 把音色前移(去 qü→チュイ、需 xü→シュイ、鱼 yü→ユイ),实听比 チュ 更像 ü。
  // ün 同理补 イ 前移成 ユイン(郡 jün→ジュイン、云 yün→ユイン),与 ü、üan 一致;旧记法 ユン 没前移、郡听着偏后 u。
  ü: 'ユイ', v: 'ユイ', üe: 'ユエ', ve: 'ユエ', üan: 'ユエン', van: 'ユエン', ün: 'ユイン', vn: 'ユイン'
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
// 零声母 i 系韵母全集,与默认加 [j] 起音的子集:首拍纯元音「イ」起音弱、易被前字吸收,前加「ユ」补起音。
// 默认子集只含纯 i(益/一/以):它是会被前字吸收的纯元音。iou(有/又)不纳入——它加 ユ 后成 ユイウ,前两拍与 ü(于=ユイ)撞音,「由」听成「于」;iou 的 イ 是介音、非会被吞的纯元音。
// 其余复韵母(ie/ian/iang 等)同理不纳入,免得给非问题加起音伪迹、又撞音。
const I_SERIES_FINALS = new Set(['i', 'ia', 'ie', 'iao', 'iu', 'iou', 'ian', 'in', 'iang', 'ing', 'iong']);
const BARE_YI_DEFAULT_FINALS = new Set(['i']);
// 以 [i] 收尾的二合元音:尾 [i] 是滑音、本应短促,供 shortenDiphthongOffGlide 把尾 [i] 收成极短滑音。
const I_OFFGLIDE_FINALS = new Set(['ai', 'ei', 'uai', 'ui', 'uei']);
// 带前介音的韵母:y 系 i 介音(ia/ie/iao/iou/ian/iang/iong)、w 系 u 介音(ua/uo/uai/uan/uang/ueng)。首个元音拍是介音、非主元音,主元音是其后的韵腹。供 ensureMainVowelShare 跳过介音、不误当主元音。
const GLIDE_INITIAL_FINALS = new Set(['ia', 'ie', 'iao', 'io', 'iou', 'iu', 'ian', 'iang', 'iong', 'ua', 'uo', 'uai', 'uei', 'ui', 'uan', 'uang', 'ueng']);
// 带 u 介音的韵母(花、欢、火、会):声母 h 在这些韵母上单独走 フ 行融合拼法,见 syllableToKana。
const U_GLIDE_FINALS = new Set(['ua', 'uo', 'uai', 'ui', 'uei', 'uan', 'un', 'uen', 'uang', 'ueng']);
// 零声母 y 后补 i 介音还原的韵母:ya→ia、ye→ie、yo→io、yao→iao、you→iou、yan→ian、yang→iang、yong→iong。
// yu 系列另走 ü;yi/yin/ying 本就 i 起头,去 y 即可,不在此列。
const Y_MEDIAL = new Set(['a', 'e', 'o', 'ao', 'ou', 'an', 'ang', 'ong']);
// 声母按长到短匹配,zh/ch/sh 优先于单字母。
const INITIALS = ['zh', 'ch', 'sh', 'b', 'p', 'm', 'f', 'd', 't', 'n', 'l', 'g', 'k', 'h', 'j', 'q', 'x', 'r', 'z', 'c', 's', 'y', 'w'];
// 普通话送气声母:这些字的塞音/塞擦音要送气([pʰ tʰ kʰ tɕʰ tsʰ tʂʰ]),日语只在短语首才给清塞音送气,见 splitFinalAspiratedStop。
const ASPIRATED_INITIALS = new Set(['p', 't', 'k', 'q', 'c', 'ch']);
// 空韵声母:这些声母 + 韵母 i 的「i」不是前高 [i](鸡 ji、西 xi 的韵母),而是舌尖元音。
// 舌尖前 [z̩](资 zi、词 ci、思 si):用 ス/ズ/ツ 基([u]、非腭化),补拍随基用 ウ,避开拗音 ィ 带来的 シ 腭化。
// 舌尖后 [ʐ̩](知 zhi、吃 chi、师 shi):仍用 ジ/チ/シ 基。两类都由 apicalizeEmptyRhyme 拉长声母擦音、使其离开前 [i],但拉长比例不同(前空韵更需拉成成音节擦音)。
// r 的卷舌空韵(日 ri)近似难度大,暂不在此列、留待后续。
const DENTAL_EMPTY_RHYME = new Set(['z', 'c', 's']);
const RETROFLEX_EMPTY_RHYME = new Set(['zh', 'ch', 'sh']);
// 同源连读判定用的腭化声母:j/q/x 与前高元音 i/ü 同为前部腭化,相接易黏成一长滑音。供 isHomorganicLiaison。
const PALATAL_INITIALS = new Set(['j', 'q', 'x']);

// 中文句合成的 audio_query 推荐参数(实听迭代定):语速 1.0,音节与停顿按原速、不压缩;音量 1.25 更响更干脆;句首句尾留白收窄,句尾不拖。
// speedScale 在 VOICEVOX 同时压缩音节与停顿。调用方取 query 后铺上这组值,再调 applyChineseProsody 整条韵律流水线。
const CHINESE_QUERY_DEFAULTS = { speedScale: 1.0, volumeScale: 1.25, prePhonemeLength: 0.08, postPhonemeLength: 0.1 };

// 个别声线偏高,按 styleId 单独压低全局音高(pitchScale);只列需要调的,其余按 0 不动。
// 26 = WhiteCUL びえーん:实听偏高,压 -0.04。28 = 後鬼 ぬいぐるみ:实听偏高,压 -0.03。16 = 九州そら ノーマル:基调偏高,压 -0.02。
const CHINESE_VOICE_PITCH = { 16: -0.02, 26: -0.04, 28: -0.03 };
//// 取某声线的中文全局音高偏移,未列出的声线为 0(不动) [@x380kkm 2026-06-16] ////
function chineseVoicePitch(styleId) {
  return CHINESE_VOICE_PITCH[styleId] != null ? CHINESE_VOICE_PITCH[styleId] : 0;
}

// 个别声线发音偏慢或偏快,按 styleId 给一个语速倍率(乘在基准 speedScale 上);只列需要调的,其余按 1 不动。
// 28 = 後鬼 ぬいぐるみ:实听偏慢,语速乘 1.08 稍快一点。
const CHINESE_VOICE_SPEED = { 28: 1.08 };
//// 取某声线的中文语速倍率,未列出的声线为 1(不动) [@x380kkm 2026-06-17] ////
function chineseVoiceSpeed(styleId) {
  return CHINESE_VOICE_SPEED[styleId] != null ? CHINESE_VOICE_SPEED[styleId] : 1;
}

// 零声母纯元音音节的片假名:这几个独立成 mora 的纯元音(如「物」ウ、「一」イ)没有声母作起音,易黏进前一鼻音听成一个字。
const BARE_VOWEL_KANA = new Set(['ア', 'イ', 'ウ', 'エ', 'オ']);

module.exports = { INITIAL_CV, FINAL_KANA, BASE_VOWEL, COMBINING, ELONGATE_FINALS, ELONGATE_VOWEL, I_SERIES_FINALS, BARE_YI_DEFAULT_FINALS, I_OFFGLIDE_FINALS, GLIDE_INITIAL_FINALS, U_GLIDE_FINALS, Y_MEDIAL, INITIALS, ASPIRATED_INITIALS, DENTAL_EMPTY_RHYME, RETROFLEX_EMPTY_RHYME, PALATAL_INITIALS, CHINESE_QUERY_DEFAULTS, CHINESE_VOICE_PITCH, chineseVoicePitch, CHINESE_VOICE_SPEED, chineseVoiceSpeed, BARE_VOWEL_KANA };
