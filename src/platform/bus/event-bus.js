// audience: internal
// # event-bus
// 进程内事件总线:情绪、发言、感知等信号一处发布、多处订阅,替代点对点 webContents.send。
// 不变量:同一事件类型的订阅者互不感知;发布方不持有任何窗口句柄,死窗口由总线侧统一过滤。

class EventBus {
  // 发布一个领域事件给所有订阅者。
  publish(event) {
    throw new Error('未实现,见目标架构设计第七节迁移里程碑');
  }

  // 订阅某类型事件,返回取消订阅的函数。
  subscribe(type, handler) {
    throw new Error('未实现,见目标架构设计第七节迁移里程碑');
  }
}

module.exports = { EventBus };
