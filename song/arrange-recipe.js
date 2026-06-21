// audience: internal
// # arrange-recipe
// 按风格与随机源为每首歌定一套「编排配方」,让配器本身每首不同(不再把同一套对位线+弦乐铺底套在所有曲上):
// 选主奏乐器音色、对位线疏密模式、弦乐处理(铺底/拨奏/不用)、是否加钢琴分解、主奏声像。配方随种子可复现。
// 纯逻辑,无副作用。pickRecipe(genre, rng) 返回 { leadProgram, counterMode, strings, pianoArp, leadPan }。

// 各风格的主奏乐器候选(GM program;均在 GeneralUser GS 里音色尚可):吉他/合成/钢琴/民族器分风格给。
const LEADS = {
  jpop: [27, 29, 30, 80, 81],          // 清音/过载/失真吉他、方波/锯齿合成主音
  janime: [27, 48, 81, 73, 0],         // 清音吉他、弦乐齐奏、锯齿合成、长笛、钢琴
  kpop: [80, 81, 82, 27, 87],          // 方波/锯齿/合声合成主音、吉他、贝斯合成
  musical: [0, 56, 48, 73, 71],        // 钢琴、小号、弦乐、长笛、单簧管
  folk: [24, 25, 105, 22, 0],          // 尼龙/钢弦吉他、班卓、口琴、钢琴
  children: [10, 12, 8, 73, 75],       // 八音盒、马林巴、钢片琴、长笛、排箫
  electronic: [80, 81, 82, 87, 62],    // 方波/锯齿/卡里欧普合成主音、合成贝斯主音、合成铜管
  trance: [81, 62, 87, 80, 50],        // 锯齿主音、合成铜管、合成贝斯主音、方波、合成弦
  bigroom: [81, 30, 62, 87, 29],       // 锯齿、失真吉他、合成铜管、合成贝斯主音、过载吉他
  dnb: [81, 30, 87, 62, 38],           // 锯齿、失真吉他、合成贝斯主音、合成铜管、合成贝斯
};
// 硬核电子族:主奏以合成器为主(锯齿/方波/合成铜管/合成贝斯主音),不用原声吉他,保证够电子。
const HARD_LEADS = [81, 81, 80, 87, 62];
// 对位线疏密模式:sustained 每半小节一个持续音(垫);fills 只在空档插短动机(呼应);active 较密的副旋律线。
const COUNTER_MODES = {
  jpop: ['fills', 'active', 'sustained'],
  janime: ['sustained', 'fills', 'active'],
  kpop: ['active', 'fills', 'fills'],
  musical: ['sustained', 'fills', 'active'],
  folk: ['fills', 'sustained', 'active'],
  children: ['fills', 'sustained', 'sustained'],
  electronic: ['active', 'active', 'fills'],
  trance: ['active', 'active', 'rise'],
  bigroom: ['active', 'fills', 'active'],
  dnb: ['active', 'active', 'fills'],
};
// 弦乐处理候选:pad 持续铺底、pizz 拨奏短点、none 不用。各风格权重不同。
const STRINGS = {
  jpop: ['pad', 'none', 'pad'],
  janime: ['pad', 'pad', 'pizz'],
  kpop: ['none', 'pizz', 'pad'],
  musical: ['pad', 'pad', 'pizz'],
  folk: ['none', 'pizz', 'none'],
  children: ['pizz', 'none', 'pad'],
  electronic: ['pad', 'pad', 'none'],
  trance: ['pad', 'pad', 'none'],
  bigroom: ['pad', 'none', 'pad'],
  dnb: ['none', 'pad', 'none'],
};

//// 取风格族名(jpop-upbeat → jpop) [@x380kkm 2026-06-20] ////
function family(genre) {
  return String(genre).split('-')[0];
}
//// /取风格族名 ////

//// 从数组按随机源取一个 [@x380kkm 2026-06-20] ////
function pick(arr, rng) {
  return arr[Math.floor(rng() * arr.length)];
}
//// /从数组取一个 ////

//// 为一首歌定编排配方:主奏音色、对位疏密、弦乐处理、是否钢琴分解、主奏声像;hard 为真则走硬核电子(更猛主奏、亮 pad、加重鼓、关钢琴分解) [@x380kkm 2026-06-20] ////
function pickRecipe(genre, rng, hard = false) {
  const fam = family(genre);
  const leads = hard ? HARD_LEADS : (LEADS[fam] || LEADS.jpop);
  const modes = COUNTER_MODES[fam] || COUNTER_MODES.jpop;
  const strs = STRINGS[fam] || STRINGS.jpop;
  return {
    leadProgram: pick(leads, rng),
    counterMode: pick(modes, rng),
    strings: pick(strs, rng),
    padProgram: hard ? 50 : 49,             // 硬核用更亮的合成弦(50)做铺底,常规用弦乐合奏(49)
    drumBoost: hard,                        // 硬核加重鼓:抬力度并补四分底鼓
    pianoArp: hard ? false : rng() < 0.45,  // 硬核不加钢琴分解(避免变柔)
    leadPan: 48 + Math.floor(rng() * 32),   // 主奏声像在中偏左到中偏右间浮动
  };
}
//// /为一首歌定编排配方 ////

module.exports = { pickRecipe };
