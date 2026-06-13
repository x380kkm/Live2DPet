// audience: internal
// # circuit-breaker
// 通用熔断容错:连续失败时降级,与具体后端无关,可复用。
// 不变量:不依赖任何语音或网络后端类型,只按调用结果计数与切换状态。
// 构造参数:maxFailures 连续失败到此值切断开态;retryInterval 断开后多久尝试恢复;now 取当前毫秒时刻;fallback 断开态下的返回值;onTrip 与 onReset 状态切换时的可选通知。

//// 按连续失败计数在闭合态与断开态间切换的熔断器 [@busybee 2026-06-13] ////
class CircuitBreaker {
  constructor({ maxFailures = 3, retryInterval = 60000, now = Date.now, fallback = null, onTrip = null, onReset = null } = {}) {
    this.maxFailures = maxFailures;
    this.retryInterval = retryInterval;
    this.now = now;
    this.fallback = fallback;
    this.onTrip = onTrip;
    this.onReset = onReset;

    this.failCount = 0;
    this.open = false;
    // 切断开态时记录的毫秒时刻,用于计算何时尝试恢复
    this.openedAt = 0;
  }

  //// 经熔断器执行一次调用,断开态下直接走降级 [@busybee 2026-06-13] ////
  execute(operation) {
    if (this._shouldReject()) return this.fallback;
    try {
      const result = operation();
      this._onSuccess();
      return result;
    } catch (err) {
      this._onFailure();
      return this.fallback;
    }
  }

  //// 当前是否处于断开态 [@busybee 2026-06-13] ////
  isOpen() {
    return this.open;
  }

  //// 断开态且未到重试时刻则拒绝,到时刻则转回闭合态尝试恢复 [@busybee 2026-06-13] ////
  _shouldReject() {
    if (!this.open) return false;
    if (this.now() - this.openedAt >= this.retryInterval) {
      this._reset();
      return false;
    }
    return true;
  }
  //// /断开态且未到重试时刻则拒绝 ////

  //// 调用成功则清零失败计数 [@busybee 2026-06-13] ////
  _onSuccess() {
    this.failCount = 0;
  }

  //// 调用失败累加计数,达到上限切断开态 [@busybee 2026-06-13] ////
  _onFailure() {
    this.failCount++;
    if (this.failCount >= this.maxFailures && !this.open) {
      this.open = true;
      this.openedAt = this.now();
      if (this.onTrip) this.onTrip();
    }
  }
  //// /调用失败累加计数 ////

  //// 转回闭合态并清零计数 [@busybee 2026-06-13] ////
  _reset() {
    this.open = false;
    this.failCount = 0;
    if (this.onReset) this.onReset();
  }
}

module.exports = { CircuitBreaker };
