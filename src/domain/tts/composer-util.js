// audience: internal
// # composer-util
// 作曲器的共享底层:音阶常量、默认风格档案、随机源加权取样,以及音高/时值的吸附与梯子等纯函数。
// 被 composer 及其和声、节奏子模块共用,自身不依赖它们,避免循环引用。
// 不变量:纯逻辑无副作用;随机源由调用方注入。

// 各音阶相对主音的半音度数：pentatonic 宫调五声、diatonic 自然大调七声、minor 自然小调七声。
const SCALES = {
  pentatonic: [0, 2, 4, 7, 9],
  diatonic: [0, 2, 4, 5, 7, 9, 11],
  minor: [0, 2, 3, 5, 7, 8, 10],
};

const BEATS_PER_BAR = 4;
// 人声绝对音域硬界(MIDI):取自切蒲英 50 首语料的实测音域(最低 53=F3、最高 76=E5,留一格余量到 77),作所有风格人声的统一上下限,防旋律被移调推出源歌手唱过的音区。
const VOCAL_RANGE = { lo: 53, hi: 77 };
// 句间气口拍数：从非末句尾部刻出，留作换气，且保持每句严格等于整小节。
const BREATH = 0.5;
// 默认风格档案:旋律可唱窗口(相对主音半音上下界)、走向基线/振幅/抖动、可选轮廓形状、中跳抑制权重;缺省即既有行为。
const DEFAULT_PROFILE = {
  register: { lo: -5, hi: 16 },
  base: 3,
  amp: 7,
  jitter: 1.5,
  shapes: ['arch'],
  midLeapW: 0.10,
};

//// 按风格加载对应模型文件 [@x380kkm 2026-06-20] ////
function loadModel(style) {
  return require(`./melody-model-${style}.json`);
}
//// /按风格加载对应模型文件 ////

//// 按计数权重从 { 键： 次数 } 里随机取一个键，空表回 null [@x380kkm 2026-06-20] ////
function pickWeighted(counts, rng) {
  let total = 0;
  for (const k in counts) total += counts[k];
  if (total <= 0) return null;
  let r = rng() * total;
  for (const k in counts) { r -= counts[k]; if (r < 0) return k; }
  return Object.keys(counts)[0];
}
//// /按计数权重随机取一个键 ////

//// 把相对主音的半音度数吸附到最近的音阶度数（跨八度）；无音阶则原样返回 [@x380kkm 2026-06-20] ////
function snapToScale(deg, scale) {
  const set = SCALES[scale];
  if (!set) return deg;
  let best = deg;
  let bestDist = Infinity;
  for (let oct = -2; oct <= 3; oct += 1) {
    for (const p of set) {
      const cand = p + 12 * oct;
      const dist = Math.abs(cand - deg);
      if (dist < bestDist) { bestDist = dist; best = cand; }
    }
  }
  return best;
}
//// /把度数吸附到最近的音阶度数 ////

//// 取一个音级（0-11）在音阶里最近的音级，用于把和弦音吸附到旋律音阶（如五声） [@x380kkm 2026-06-20] ////
function nearestScalePc(pc, scaleSet) {
  let best = scaleSet[0];
  let bestDist = 99;
  for (const s of scaleSet) {
    const d = Math.min(((pc - s) % 12 + 12) % 12, ((s - pc) % 12 + 12) % 12);
    if (d < bestDist) { bestDist = d; best = s; }
  }
  return best;
}
//// /取音阶里最近的音级 ////

//// 列出旋律音阶在可唱窗口内的全部音高（相对主音、升序），作为级进的「梯子」；register 给上下界 [@x380kkm 2026-06-20] ////
function buildLadder(scaleSet, register = DEFAULT_PROFILE.register) {
  const out = [];
  for (let oct = -1; oct <= 2; oct += 1) {
    for (const p of scaleSet) {
      const v = p + 12 * oct;
      if (v >= register.lo && v <= register.hi) out.push(v);
    }
  }
  out.sort((a, b) => a - b);
  return out;
}
//// /列出旋律音阶的梯子 ////

//// 取数组里最接近某值的元素 [@x380kkm 2026-06-20] ////
function nearestIn(arr, x) {
  let best = arr[0];
  let bd = Infinity;
  for (const v of arr) { const d = Math.abs(v - x); if (d < bd) { bd = d; best = v; } }
  return best;
}
//// /取数组里最接近的元素 ////

//// 把时值吸附到半拍格(最小 0.5),并格式化成 dur1 表的键(整数补 .0) [@x380kkm 2026-06-20] ////
function snapDur(d) {
  const s = Math.max(0.5, Math.round(d * 2) / 2);
  return s;
}
function durKey(d) {
  return Number.isInteger(d) ? d.toFixed(1) : String(d);
}
//// /时值吸附与键格式化 ////

module.exports = {
  SCALES, BEATS_PER_BAR, BREATH, DEFAULT_PROFILE, VOCAL_RANGE,
  loadModel, pickWeighted, snapToScale, nearestScalePc, buildLadder, nearestIn, snapDur, durKey,
};
