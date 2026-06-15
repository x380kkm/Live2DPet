// audience: internal
// # event-bus
// 进程内事件总线:情绪、发言、感知等信号一处发布、多处订阅。
// 不变量:同一事件类型的订阅者互不感知;发布方不持有任何窗口句柄,死窗口由总线侧统一过滤。

class EventBus {
  //// 建立按事件类型分组的订阅表 [@x380kkm 2026-06-13] ////
  constructor() {
    // 键是事件类型,值是该类型的订阅记录数组。
    this._subscriptions = new Map();
  }

  //// 发布一个领域事件给所有存活订阅者,顺带剔除死订阅 [@x380kkm 2026-06-13] ////
  publish(event) {
    const records = this._subscriptions.get(event.type);
    if (!records || records.length === 0) {
      return;
    }
    // 复制一份再遍历,使处理器内的订阅或取消订阅不打断本次分发。
    const snapshot = records.slice();
    const dead = [];
    for (const record of snapshot) {
      if (!record.isAlive()) {
        dead.push(record);
        continue;
      }
      record.handler(event);
    }
    this._prune(event.type, dead);
  }
  //// /发布一个领域事件给所有存活订阅者,顺带剔除死订阅 ////

  //// 订阅某类型事件,返回取消订阅的函数 [@x380kkm 2026-06-13] ////
  // isAlive 是可选的存活判断,缺省恒为存活;窗口订阅者传入它,总线据此统一过滤死窗口。
  subscribe(type, handler, isAlive) {
    const record = { handler, isAlive: isAlive || ALWAYS_ALIVE };
    let records = this._subscriptions.get(type);
    if (!records) {
      records = [];
      this._subscriptions.set(type, records);
    }
    records.push(record);
    return () => this._remove(type, record);
  }
  //// /订阅某类型事件,返回取消订阅的函数 ////

  //// 从某类型的订阅表移除一条记录 [@x380kkm 2026-06-13] ////
  _remove(type, record) {
    const records = this._subscriptions.get(type);
    if (!records) {
      return;
    }
    const index = records.indexOf(record);
    if (index !== -1) {
      records.splice(index, 1);
    }
    if (records.length === 0) {
      this._subscriptions.delete(type);
    }
  }

  //// 批量移除已判定为死的订阅记录 [@x380kkm 2026-06-13] ////
  _prune(type, dead) {
    for (const record of dead) {
      this._remove(type, record);
    }
  }
}

// 缺省存活判断:没有提供 isAlive 的订阅者视为始终存活。
const ALWAYS_ALIVE = () => true;

module.exports = { EventBus };
