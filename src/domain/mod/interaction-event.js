// audience: internal
// # interaction-event
// 交互感知化契约:mod 前端产出事件、意图消费,作为前端层与意图层之间的通道。
// 不变量:事件只承载交互语义,系统副作用留宿主、不经此契约传递。

class InteractionEvent {
  constructor() {
    // 事件名,意图按此名匹配触发
    this.name = null;
    // 事件附带的交互语义数据
    this.payload = null;
  }
}

module.exports = { InteractionEvent };
