// audience: internal
// # emotion-state
// 情绪积累与阈值:纯状态推进,到阈值发事件。
// 不变量:本模块只推进状态并发事件,不直接播放表情或动作;输出经事件总线对外。
//
// 依赖经构造注入:bus 为事件总线,config 给定阈值与每拍积累量。
// 输入经 feed 喂入,形如 { kind:'tick', hovering? } 或 { kind:'reply', length }。
// 到阈值时发布 { type:'EmotionThresholdReached', value },不直接选情绪、不播放。

// 到阈值时对外发布的事件类型。
const THRESHOLD_REACHED = 'EmotionThresholdReached';

// 缺省参数:阈值与每拍基础积累量,悬停时叠加的额外量,以及回复加成的取值区间。
const DEFAULT_CONFIG = {
  threshold: 100,
  baseRatePerTick: 100 / 60,
  hoverRatePerTick: (100 / 60) * 0.5,
  replyBonusBase: 5,
  replyBonusSpan: 25,
  replyLengthCap: 200
};

class EmotionState {
  //// 构造注入事件总线与积累参数,把当前情绪值清零 [@busybee 2026-06-13] ////
  // bus 为事件总线;config 缺省键回退到 DEFAULT_CONFIG;随机源 random 可注入以便测试。
  constructor(bus, config, deps) {
    this.bus = bus;
    this.config = { ...DEFAULT_CONFIG, ...(config || {}) };
    this.random = (deps && deps.random) || Math.random;

    // 当前情绪态:积累到阈值的标量值。
    this.current = 0;
  }

  //// 外部直喂一次情绪输入,推进当前值,到阈值则发事件并清零 [@busybee 2026-06-13] ////
  // input.kind 为 'tick' 时按基础量推进,悬停叠加;为 'reply' 时按文本长度给一次性加成。
  feed(input) {
    this.current += this._increment(input);
    if (this.hasReachedThreshold()) {
      this._publishThreshold();
      this.current = 0;
    }
  }
  //// /外部直喂一次情绪输入 ////

  //// 判定当前值是否到达阈值 [@busybee 2026-06-13] ////
  hasReachedThreshold() {
    return this.current >= this.config.threshold;
  }

  //// 把一次输入折算成本次推进量 [@busybee 2026-06-13] ////
  _increment(input) {
    if (!input) return 0;
    if (input.kind === 'reply') {
      return this._replyBonus(input.length || 0);
    }
    // 缺省按一拍推进:基础量,悬停时叠加悬停量。
    let amount = this.config.baseRatePerTick;
    if (input.hovering) {
      amount += this.config.hoverRatePerTick;
    }
    return amount;
  }

  //// 按文本长度算一次性回复加成,越长加成上限越高 [@busybee 2026-06-13] ////
  _replyBonus(length) {
    const lengthFactor = Math.min(length / this.config.replyLengthCap, 1);
    return this.config.replyBonusBase + this.random() * this.config.replyBonusSpan * lengthFactor;
  }

  //// 向总线发布到阈值事件,携带越过阈值时的情绪值 [@busybee 2026-06-13] ////
  _publishThreshold() {
    this.bus.publish({ type: THRESHOLD_REACHED, value: this.current });
  }
}

module.exports = { EmotionState, THRESHOLD_REACHED };
