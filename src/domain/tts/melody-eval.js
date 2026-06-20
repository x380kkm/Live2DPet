// audience: internal
// # melody-eval
// 旋律内部一致性评估：无参考地量化一段旋律「搭不搭」，用于自助迭代（不必每段都靠人耳）。
// 盯的是生成内容内部的撕裂：大跳过多、音域塌缩或过宽、级进太少、节奏不对齐拍格、缺动机重复（自相似低）、熵过高过低。
// 纯逻辑无副作用；输入为 song-score 的旋律格式（发声音符 { key, beats }、休止 { rest }）或扁平音符表。

const zlib = require('zlib');

// 各指标的合理区间与权重：落区间内不扣分，出界按距离线性扣；权重体现对「撕裂」的敏感度。
const BANDS = {
  stepRatio: { lo: 0.30, hi: 0.85, weight: 2 },    // 级进（相邻音程≤2 半音）占比：太低则跳跃零散、太高则平；五声以小三度为「级」，占比天然偏低，故下界放宽
  leapRate: { lo: 0, hi: 0.32, weight: 2 },         // 大跳（>7 半音）占比：上界按真实语料校准(动漫自然约 0.31),只在极端跳跃成灾时才扣
  rangeSemitones: { lo: 7, hi: 22, weight: 1.5 },   // 音域跨度：太窄单调、太宽难唱;动漫戏剧性大跳音域偏宽,故放宽上界
  repeatRate: { lo: 0.0, hi: 0.18, weight: 1.5 },   // 同音重复占比：太高发木、卡在一个音上
  dominantPitchFraction: { lo: 0.0, hi: 0.40, weight: 2 }, // 最常出现音高的占比：太高=老围着一个音转、「完全一个调」（动机重复不在此列）
  beatAlign: { lo: 0.8, hi: 1.0, weight: 1.5 },     // 音符起点落在半拍格上的比例：越高节奏越稳
  pitchClassEntropy: { lo: 1.6, hi: 2.6, weight: 1 }, // 音级熵（比特）：太低呆板、太高混乱
  selfSimilarity: { lo: 0.30, hi: 0.85, weight: 1 }, // 自相似（1-压缩率）：太低无动机重复、太散
};

//// 取发声音符序列（过滤休止），保留出现顺序的 key 与 beats [@x380kkm 2026-06-20] ////
function sungNotes(melody) {
  return melody.filter((e) => e.rest == null && e.key != null).map((e) => ({ key: e.key, beats: e.beats }));
}
//// /取发声音符序列 ////

//// 算香农熵（比特），输入为计数表 [@x380kkm 2026-06-20] ////
function entropy(counts) {
  const total = Object.values(counts).reduce((a, b) => a + b, 0);
  if (total <= 0) return 0;
  let h = 0;
  for (const k in counts) {
    const p = counts[k] / total;
    if (p > 0) h -= p * Math.log2(p);
  }
  return h;
}
//// /算香农熵 ////

//// 抽一段旋律的内部一致性特征 [@x380kkm 2026-06-20] ////
function features(melody) {
  const notes = sungNotes(melody);
  const keys = notes.map((n) => n.key);
  const n = keys.length;
  if (n < 2) return null;
  const intervals = [];
  for (let i = 1; i < n; i += 1) intervals.push(keys[i] - keys[i - 1]);
  const abs = intervals.map(Math.abs);
  const stepRatio = abs.filter((d) => d <= 2).length / abs.length;
  const leapRate = abs.filter((d) => d > 7).length / abs.length;
  const repeatRate = abs.filter((d) => d === 0).length / abs.length;
  const rangeSemitones = Math.max(...keys) - Math.min(...keys);
  // 音符起点对齐：累计拍数（含休止）落在半拍格（0.5 的整数倍）上的比例
  let cum = 0;
  let aligned = 0;
  let onsets = 0;
  for (const e of melody) {
    if (e.rest == null && e.key != null) {
      const r = Math.abs(((cum / 0.5) % 1));
      if (r < 0.06 || r > 0.94) aligned += 1;
      onsets += 1;
    }
    cum += (e.rest != null ? e.rest : e.beats);
  }
  const beatAlign = onsets ? aligned / onsets : 0;
  // 最常出现音高的占比：统计各 MIDI 音出现次数取最大值除以总数，过高说明旋律塌成「一个调」（动机重复不会拉高它）
  const keyCounts = {};
  let dominant = 0;
  for (const k of keys) { keyCounts[k] = (keyCounts[k] || 0) + 1; dominant = Math.max(dominant, keyCounts[k]); }
  const dominantPitchFraction = dominant / n;
  const pcCounts = {};
  for (const k of keys) { const pc = ((k % 12) + 12) % 12; pcCounts[pc] = (pcCounts[pc] || 0) + 1; }
  const pitchClassEntropy = entropy(pcCounts);
  // 自相似：把音级序列压缩，1 - 压缩率越高说明越有重复结构（动机）
  const seq = Buffer.from(keys.map((k) => ((k % 12) + 12) % 12));
  const selfSimilarity = seq.length >= 8 ? 1 - zlib.deflateRawSync(seq).length / seq.length : 0.5;
  return { noteCount: n, stepRatio, leapRate, repeatRate, rangeSemitones, dominantPitchFraction, beatAlign, pitchClassEntropy, selfSimilarity };
}
//// /抽一段旋律的内部一致性特征 ////

//// 把单个特征按区间折成 0-1 贴合度：区间内 1，出界按到边界距离衰减 [@x380kkm 2026-06-20] ////
function bandScore(value, band) {
  if (value >= band.lo && value <= band.hi) return 1;
  const span = (band.hi - band.lo) || 1;
  const dist = value < band.lo ? band.lo - value : value - band.hi;
  return Math.max(0, 1 - dist / span);
}
//// /把单个特征按区间折成贴合度 ////

//// 评估一段旋律：出特征、各项贴合度、加权总分（0-100）与越界标记 [@x380kkm 2026-06-20] ////
function evaluateMelody(melody) {
  const f = features(melody);
  if (!f) return { score: 0, features: f, parts: {}, flags: ['音符太少'] };
  let sum = 0;
  let wsum = 0;
  const parts = {};
  const flags = [];
  for (const key in BANDS) {
    const band = BANDS[key];
    const s = bandScore(f[key], band);
    parts[key] = Number(s.toFixed(2));
    sum += s * band.weight;
    wsum += band.weight;
    if (s < 0.6) flags.push(`${key}=${Number(f[key].toFixed(2))} 偏离`);
  }
  return { score: Math.round((sum / wsum) * 100), features: f, parts, flags };
}
//// /评估一段旋律 ////

module.exports = { evaluateMelody, features, BANDS };
