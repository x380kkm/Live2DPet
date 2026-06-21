// audience: internal
// # syllabify
// 把作曲的逐音旋律(每音一个 { key, beats })重组为「逐音节」旋律,供歌词演唱:整拍起音开一个音节,其后落在半拍弱位的音并入前一音节作花腔。
// 这样一个汉字唱一个整拍单位(弱位经过音melisma 进同一字),避免一字一音的急促念白感;休止保留以分乐句。
// 输出条目与 song-score 的 buildScore 兼容:单音 { key, beats }、花腔 { notes:[[key,beats],...] }、休止 { rest }。

function syllabify(melody) {
  const out = [];
  let cum = 0;
  let cur = null; // 当前音节累积的 [key, beats] 列表
  const flush = () => {
    if (!cur) return;
    out.push(cur.length === 1 ? { key: cur[0][0], beats: cur[0][1] } : { notes: cur.slice() });
    cur = null;
  };
  for (const e of melody) {
    if (e.rest != null) { flush(); out.push({ rest: e.rest }); cum += e.rest; continue; }
    const onInteger = Math.abs(cum - Math.round(cum)) < 1e-9;
    if (onInteger || !cur) { flush(); cur = [[e.key, e.beats]]; } else { cur.push([e.key, e.beats]); }
    cum += e.beats;
  }
  flush();
  return out;
}

//// 取一个音在调内的上下邻音(绝对 MIDI),并限制在音域 [lo,hi] 内:用于花腔运音落在音阶上且不冲出人声音域 [@x380kkm 2026-06-21] ////
function scaleNeighbors(key, tonicMidi, scaleSet, lo, hi) {
  const lad = [];
  for (let oct = -2; oct <= 9; oct += 1) for (const p of scaleSet) { const v = tonicMidi + p + 12 * oct; if (v >= lo && v <= hi) lad.push(v); }
  lad.sort((a, b) => a - b);
  let i = lad.indexOf(key);
  if (i < 0) { let bd = 1e9; lad.forEach((v, j) => { const d = Math.abs(v - key); if (d < bd) { bd = d; i = j; } }); }
  const at = (j) => lad[Math.max(0, Math.min(lad.length - 1, j))];
  // 越界时退回本音,使运音不超出音域(邻音等于本音即该处不动)。
  return { up: at(i + 1), up2: at(i + 2), down: at(i - 1), down2: at(i - 2) };
}
//// /取调内上下邻音 ////

const Q = 0.25; // 花腔最小子拍(四分网格上的十六分)
const round4 = (x) => Math.round(x * 4) / 4;

//// 为一个可花腔的长音造一条调内运音:主音占头拍保住和声,尾部缀一小串邻音/级进回到主音,总拍不变 [@x380kkm 2026-06-21] ////
// end 为乐句末:更倾向回音式拖腔(turn);句中用简短邻音挑。返回 [[绝对MIDI, 拍数], ...],单元素表示不花腔。
function melismaRun(key, beats, nb, rng, end) {
  if (beats < 1.0) return [[key, beats]];
  const c = rng();
  if (end && beats >= 1.5 && c < 0.6) {
    const head = round4(beats - 4 * Q);
    if (head >= Q) return [[key, head], [nb.up, Q], [key, Q], [nb.down, Q], [key, Q]]; // 回音 turn
  }
  if (beats >= 1.5 && c < 0.5) {
    const head = round4(beats - 3 * Q);
    if (head >= Q) return [[key, head], [nb.down, Q], [nb.down2, Q], [nb.down, Q]]; // 下行级进拖腔
  }
  const head = round4(beats - 2 * Q);
  if (head >= Q) return [[key, head], [nb.up, Q], [key, Q]]; // 上邻音轻挑回主音
  return [[key, beats]];
}
//// /造一条调内运音 ////

//// 给可唱旋律加花腔:把够长的音节(尤其句末)展开成同一音节上的调内运音,使演唱有拖腔而非一字一音的方块感 [@x380kkm 2026-06-21] ////
// 花腔只增「一个音节内的音符数」,不改发声音节总数,故歌词逐音节对齐不变。需 scaleSet 与 tonicMidi 把运音锁在调上;prob 为句中长音加花腔的概率(句末必加)。
function addMelisma(singable, { scaleSet, tonicMidi, rng, prob = 0.25, lo = 0, hi = 127 } = {}) {
  if (!scaleSet) return singable;
  const r = rng || Math.random;
  const out = [];
  for (let i = 0; i < singable.length; i += 1) {
    const e = singable[i];
    if (e.rest != null || e.notes) { out.push(e); continue; }
    const isPhraseEnd = (i + 1 >= singable.length) || singable[i + 1].rest != null;
    // 花腔宜稀不宜密:句末长音(不短于 1 拍)作收腔多半加;句中只对更长的音(不短于 1.5 拍)按低概率偶尔加。
    const eligible = isPhraseEnd ? (e.beats >= 1.0 && r() < 0.7) : (e.beats >= 1.5 && r() < prob);
    if (!eligible) { out.push(e); continue; }
    const run = melismaRun(e.key, e.beats, scaleNeighbors(e.key, tonicMidi, scaleSet, lo, hi), r, isPhraseEnd);
    out.push(run.length === 1 ? { key: e.key, beats: e.beats } : { notes: run });
  }
  return out;
}
//// /给可唱旋律加花腔 ////

//// 按休止切乐句,数每句的发声音节数,返回 [每句音节数] 与总数 [@x380kkm 2026-06-20] ////
function syllableBudget(singable) {
  const perPhrase = [];
  let n = 0;
  for (const e of singable) {
    if (e.rest != null) { perPhrase.push(n); n = 0; } else n += 1;
  }
  perPhrase.push(n);
  return { perPhrase, total: perPhrase.reduce((a, b) => a + b, 0) };
}
//// /数每句音节数 ////

module.exports = { syllabify, syllableBudget, addMelisma };
