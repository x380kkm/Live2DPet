// audience: internal
// # low-discrepancy
// 低差异序列生成器:加性递归,每步加黄金比共轭再取小数部分,产出落在 [0,1) 且分布比纯随机均匀的序列。
// 不变量:序列确定、无外部副作用;同一起始种子产出同一序列;值恒在 [0,1)。
//
// 它把权重转成均匀铺开的抽样,供模组子意图扰动的采样与引入台词的轮换用:实际出现频率贴近设定权重,
// 避免纯随机在短窗口里扎堆或长时间不出某个模组。最终选哪个行为由模型决定,本模块只产出建议序号或轮换序号。

// 黄金比共轭 (√5 − 1)/2:加性递归以它作步长,得到已知最低差异的一维序列。
const GOLDEN_RATIO_CONJUGATE = 0.6180339887498949;

class LowDiscrepancySequence {
  //// 构造注入起始种子,缺省从 0 开始,种子先归一到 [0,1) [@busybee 2026-06-14] ////
  constructor(seed = 0) {
    const s = typeof seed === 'number' && Number.isFinite(seed) ? seed : 0;
    // 当前位置,落在 [0,1);每次 next 前进一个黄金比共轭再取小数部分。
    this._x = ((s % 1) + 1) % 1;
  }

  //// 取序列的下一个值,落在 [0,1) [@busybee 2026-06-14] ////
  next() {
    this._x = (this._x + GOLDEN_RATIO_CONJUGATE) % 1;
    return this._x;
  }
}

//// 用一个 [0,1) 抽样值按权重选一个下标,累计权重的逆变换抽样 [@busybee 2026-06-14] ////
// weights 为非负权重数组,负值按零计;u 为 [0,1) 抽样值;总权重为零时返回 0。
function pickByWeight(weights, u) {
  const positive = weights.map((w) => (w > 0 ? w : 0));
  const total = positive.reduce((sum, w) => sum + w, 0);
  if (total <= 0) {
    return 0;
  }
  const target = u * total;
  let acc = 0;
  for (let i = 0; i < positive.length; i++) {
    acc += positive[i];
    if (target < acc) {
      return i;
    }
  }
  return positive.length - 1;
}

module.exports = { LowDiscrepancySequence, pickByWeight, GOLDEN_RATIO_CONJUGATE };
