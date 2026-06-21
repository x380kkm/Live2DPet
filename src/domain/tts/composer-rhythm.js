// audience: internal
// # composer-rhythm
// 作曲器的节奏层:内置 4/4 节奏型、按语料时值转移取一小节节奏型、造乐句节奏骨架,以及第二声部的繁简变形。
// 节奏骨架与音高分离:重复乐句复用同一骨架但重采音高(变奏式再现);第二声部由主声部骨架繁简变形而来、节奏相近而互补。
// 不变量:纯逻辑无副作用;随机源由调用方注入。

const { BEATS_PER_BAR, pickWeighted, snapDur, durKey } = require('./composer-util');

// 4/4 小节的节奏型：各型时值之和为 4 拍、都落在半拍格上；权重偏向均匀与常见 pop 切分。每型都含落在第 1 拍与第 3 拍的音，以提供强拍锚点。
const BAR_PATTERNS = [
  { pat: [1, 1, 1, 1], w: 3 },
  { pat: [2, 1, 1], w: 2 },
  { pat: [1, 1, 2], w: 2 },
  { pat: [2, 2], w: 1 },
  { pat: [1, 0.5, 0.5, 1, 1], w: 2 },
  { pat: [0.5, 0.5, 1, 1, 1], w: 2 },
  { pat: [1, 1, 0.5, 0.5, 1], w: 1.5 },
  { pat: [1.5, 0.5, 1, 1], w: 1.5 },
  { pat: [1, 1, 1, 0.5, 0.5], w: 1.5 },
  { pat: [0.5, 0.5, 0.5, 0.5, 1, 1], w: 1 },
];

const COUNTER_SPLIT_PROB = 0.4; // 第二声部把主声部长音(不短于 COUNTER_LONG_BEATS)劈成两半的概率:人声持续时吉他走动,繁简法里第二声部作「繁」。
const COUNTER_MERGE_PROB = 0.35; // 第二声部把主声部相邻短音(不长于 COUNTER_SHORT_BEATS)并成一个的概率:人声密集时吉他持续,繁简法里第二声部作「简」。
const COUNTER_LONG_BEATS = 1.5; // 视为「长音」可劈的下限拍数。
const COUNTER_SHORT_BEATS = 0.5; // 视为「短音」可并的上限拍数。

//// 取一个小节节奏型:优先用语料训练的时值转移 dur1 采样并填满 4 拍,无 dur 数据时退回内置型 [@x380kkm 2026-06-20] ////
function pickBarPattern(rng, model, state) {
  const hasDur = model && model.dur1 && model.durStart && Object.keys(model.durStart).length > 0;
  if (!hasDur) {
    const counts = {};
    BAR_PATTERNS.forEach((b, i) => { counts[i] = b.w; });
    return BAR_PATTERNS[parseInt(pickWeighted(counts, rng), 10)].pat;
  }
  const out = [];
  let rem = BEATS_PER_BAR;
  while (rem > 1e-9) {
    const tbl = (state.prev != null && model.dur1[durKey(state.prev)]) || model.durStart;
    let d = snapDur(parseFloat(pickWeighted(tbl, rng)));
    if (d > rem) d = rem; // 末尾截到正好填满整小节
    out.push(d);
    rem -= d;
    state.prev = d;
  }
  return out;
}
//// /取一个小节节奏型 ////

//// 造一个乐句的节奏骨架:逐小节用语料时值转移取节奏型,记下每音的时值、小节内起拍与是否强拍(第 1、3 拍) [@x380kkm 2026-06-20] ////
function buildBlueprint(model, bars, rng) {
  const slots = [];
  const durState = { prev: null };
  for (let b = 0; b < bars; b += 1) {
    let pos = 0;
    for (const dur of pickBarPattern(rng, model, durState)) {
      const strong = Math.abs(pos - 0) < 1e-9 || Math.abs(pos - 2) < 1e-9;
      slots.push({ beats: dur, bar: b, onset: pos, strong });
      pos += dur;
    }
  }
  return slots;
}
//// /造节奏骨架 ////

//// 在每小节内对一串时值做繁简变形:长音劈半、相邻短音并一,产出与原节奏相近但互补的时值序列 [@x380kkm 2026-06-21] ////
// 用于第二声部:人声持续(长音)时吉他走动,人声密集(短音连排)时吉他持续;每小节总拍不变,故不破坏小节对齐。
function varyDurs(durs, rng) {
  const out = [];
  for (let i = 0; i < durs.length; i += 1) {
    const d = durs[i];
    if (d >= COUNTER_LONG_BEATS && rng() < COUNTER_SPLIT_PROB) { out.push(d / 2, d / 2); continue; }
    if (d <= COUNTER_SHORT_BEATS && i + 1 < durs.length && durs[i + 1] <= COUNTER_SHORT_BEATS && rng() < COUNTER_MERGE_PROB) {
      out.push(d + durs[i + 1]); i += 1; continue;
    }
    out.push(d);
  }
  return out;
}
//// /对一串时值做繁简变形 ////

//// 由主声部节奏骨架派生第二声部的互补骨架:逐小节做繁简变形后重排出带 bar/onset/strong 的新槽位 [@x380kkm 2026-06-21] ////
// 在每小节内变形并保持小节总拍不变,使第二声部与主声部节奏相近而不同、彼此呼应,且仍逐小节与伴奏对齐。
function varyRhythm(slots, rng) {
  const byBar = new Map();
  for (const s of slots) { if (!byBar.has(s.bar)) byBar.set(s.bar, []); byBar.get(s.bar).push(s.beats); }
  const out = [];
  for (const bar of [...byBar.keys()].sort((a, b) => a - b)) {
    let pos = 0;
    for (const dur of varyDurs(byBar.get(bar), rng)) {
      const strong = Math.abs(pos - 0) < 1e-9 || Math.abs(pos - 2) < 1e-9;
      out.push({ beats: dur, bar, onset: pos, strong });
      pos += dur;
    }
  }
  return out;
}
//// /派生第二声部的互补骨架 ////

module.exports = { BAR_PATTERNS, pickBarPattern, buildBlueprint, varyDurs, varyRhythm };
