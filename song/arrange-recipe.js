// audience: internal
// # arrange-recipe
// 按风格的配器调色板与随机源为每首歌定一套「编排配方」,让配器本身每首不同(不再把同一套对位线加弦乐铺底套在所有曲上):
// 选主奏乐器音色、对位线疏密模式、弦乐处理(铺底/拨奏/不用)、是否加钢琴分解、主奏声像。调色板由各风格代号在 style-profiles 里声明,故配器随风格而非靠硬编码族名。
// 纯逻辑,无副作用。pickRecipe(resolved, rng) 收 resolveGenre 的返回(含 palette 与 hard),返回 { leadProgram, counterMode, strings, pianoArp, padProgram, drumBoost, leadPan }。

//// 从数组按随机源取一个 [@x380kkm 2026-06-20] ////
function pick(arr, rng) {
  return arr[Math.floor(rng() * arr.length)];
}
//// /从数组取一个 ////

//// 为一首歌定编排配方:主奏音色、对位疏密、弦乐处理、钢琴分解、主奏声像,均取自该风格的配器调色板;hard 为真则加重鼓并关钢琴分解 [@x380kkm 2026-06-21] ////
// resolved 为 resolveGenre 的返回,带 palette { leads, counter, strings, pad, pianoArp } 与 hard。
function pickRecipe(resolved, rng) {
  const p = (resolved && resolved.palette) || {};
  const leads = p.leads || [0, 24, 27];
  const modes = p.counter || ['fills', 'active', 'sustained'];
  const strs = p.strings || ['pad', 'none'];
  const hard = !!(resolved && resolved.hard);
  return {
    leadProgram: pick(leads, rng),
    counterMode: pick(modes, rng),
    strings: pick(strs, rng),
    padProgram: p.pad != null ? p.pad : (hard ? 50 : 49),
    drumBoost: hard,                                      // 硬核加重鼓:抬力度并补四分底鼓
    pianoArp: hard ? false : rng() < (p.pianoArp != null ? p.pianoArp : 0.4),
    leadPan: 48 + Math.floor(rng() * 32),                // 主奏声像在中偏左到中偏右间浮动
  };
}
//// /为一首歌定编排配方 ////

module.exports = { pickRecipe };
