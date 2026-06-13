// audience: internal
// # circuit-breaker
// 通用熔断容错:连续失败时降级,与具体后端无关,可复用。
// 不变量:不依赖任何语音或网络后端类型,只按调用结果计数与切换状态。

class CircuitBreaker {
  // 经熔断器执行一次调用,断开态下直接走降级。
  execute(operation) {
    throw new Error('未实现,见目标架构设计第七节迁移里程碑');
  }

  // 当前是否处于断开态。
  isOpen() {
    throw new Error('未实现,见目标架构设计第七节迁移里程碑');
  }
}

module.exports = { CircuitBreaker };
