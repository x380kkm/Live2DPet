// audience: internal
// # interaction-event
// 交互感知化契约:mod 前端产出事件、意图消费,作为前端层与意图层之间的通道。
// 不变量:事件只承载交互语义,系统副作用留宿主、不经此契约传递。
//
// 事件经事件总线发布,type 固定取 INTERACTION_EVENT_TYPE 让意图层统一订阅;
// 真正区分一次交互的是 name,意图按 name 声明自己消费哪些交互。
// payload 是纯数据,只描述交互本身(命中区、时长、次数等),不含任何宿主侧句柄或副作用指令。

// 总线上的事件类型:所有交互事件共用这一个 type,意图层据此一处订阅。
const INTERACTION_EVENT_TYPE = 'InteractionEvent';

class InteractionEvent {
  //// 用事件名与交互语义数据构造一个交互事件 [@x380kkm 2026-06-13] ////
  constructor(name, payload) {
    // 总线分发用的类型,恒为交互事件类型,意图层据此订阅。
    this.type = INTERACTION_EVENT_TYPE;
    // 事件名,意图按此名匹配触发,如 click、touch、drag。
    this.name = name || null;
    // 事件附带的交互语义数据,纯数据快照。
    this.payload = payload || null;
  }
}

//// 判断一个值是否为结构合法的交互事件 [@x380kkm 2026-06-13] ////
// 合法要求:type 为交互事件类型且 name 是非空字符串;意图层据此过滤总线上的非交互事件。
function isInteractionEvent(value) {
  return (
    value != null &&
    value.type === INTERACTION_EVENT_TYPE &&
    typeof value.name === 'string' &&
    value.name.length > 0
  );
}

module.exports = { InteractionEvent, isInteractionEvent, INTERACTION_EVENT_TYPE };
