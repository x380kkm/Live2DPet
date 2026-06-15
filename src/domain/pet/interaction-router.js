// audience: internal
// # interaction-router
// 交互事件驱动的意图入口:mod 交互事件经事件总线进来,据事件名取声明消费它的意图、选一个、跑出回应。
// 不变量:这是不经截图循环的外部触发入口;只消费交互事件、不持窗口句柄;单次路由失败只记录,不抛回总线。
// 落实三种智能里的「运行期有界事件反应」:交互是事件、每次只跑一个意图,不是每帧调模型。

const { TriggerWhen } = require('../intent/intent');
const { INTERACTION_EVENT_TYPE } = require('../mod/interaction-event');

class InteractionRouter {
  //// 构造注入事件总线、意图注册表、pet 编排器 [@x380kkm 2026-06-14] ////
  // deps:{ eventBus, registry(IntentRegistry), pet(PetOrchestrator) }。
  constructor(deps = {}) {
    this.eventBus = deps.eventBus;
    this.registry = deps.registry;
    this.pet = deps.pet;
    this._unsub = null;
  }

  //// 订阅交互事件,重复启动无副作用 [@x380kkm 2026-06-14] ////
  start() {
    if (this._unsub || !this.eventBus) return;
    this._unsub = this.eventBus.subscribe(INTERACTION_EVENT_TYPE, (event) => {
      Promise.resolve(this._route(event)).catch(logRouteError);
    });
  }
  //// /订阅交互事件 ////

  //// 取消订阅,重复停止无副作用 [@x380kkm 2026-06-14] ////
  stop() {
    if (this._unsub) { this._unsub(); this._unsub = null; }
  }

  //// 路由一次交互:据事件名取声明消费它的意图作候选、选一个、跑出回应 [@x380kkm 2026-06-14] ////
  // 候选只取声明消费 mod 事件的意图;空闲意图虽在无视觉输入下本会被选,但一次交互不该触发空闲闲聊,故按触发类型滤掉。
  async _route(event) {
    if (!event || typeof event.name !== 'string' || !event.name) return null;
    const scope = {
      signals: { hasVisualInput: false, modEvents: [event.name] },
      situationDigest: '',
      interaction: { name: event.name, payload: event.payload || null }
    };
    const candidates = this.registry.candidates(scope).filter(
      (intent) => intent && intent.trigger && intent.trigger.when === TriggerWhen.ModEvent
    );
    if (candidates.length === 0) return null;
    const intent = await this.pet.selectIntent(candidates, scope);
    if (!intent) return null;
    return this.pet.run(intent, scope);
  }
  //// /路由一次交互 ////
}

//// 路由失败时记录,有 console 才打,无则静默 [@x380kkm 2026-06-14] ////
function logRouteError(error) {
  if (typeof console !== 'undefined' && typeof console.error === 'function') {
    console.error('[InteractionRouter] 路由交互失败:', error && error.message ? error.message : error);
  }
}
//// /路由失败时记录 ////

module.exports = { InteractionRouter };
