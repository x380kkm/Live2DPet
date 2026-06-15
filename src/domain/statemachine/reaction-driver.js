// audience: internal
// # reaction-driver
// 状态机反应驱动:订阅状态机的边界态事件,组装反应提示词,交有界反应策略产出角色反应。
// 不变量:反应由状态边界事件触发、不每帧调用;本驱动只接线,自身不调模型、不碰渲染。
// 这是给情绪与发言的又一个不经截图循环的外部触发入口:mod 内的游戏状态在关键节点驱动角色反应。

// 状态机进入边界态时发布的事件类型:由 state-machine 发出,本驱动据此订阅。
const STATE_REACTION_TYPE = 'StateReaction';

class ReactionDriver {
  //// 构造注入事件总线、有界反应策略、反应提示词组装函数 [@x380kkm 2026-06-14] ////
  // deps:{ eventBus, reactionPolicy(ReactionPolicy), composeScope(event) => { messages } }。
  constructor(deps = {}) {
    this.eventBus = deps.eventBus;
    this.reactionPolicy = deps.reactionPolicy;
    this.composeScope = deps.composeScope;
    this._unsub = null;
  }

  //// 订阅边界态事件,重复启动无副作用 [@x380kkm 2026-06-14] ////
  start() {
    if (this._unsub || !this.eventBus) return;
    this._unsub = this.eventBus.subscribe(STATE_REACTION_TYPE, (event) => {
      Promise.resolve(this._react(event)).catch(logReactError);
    });
  }
  //// /订阅边界态事件 ////

  //// 取消订阅,重复停止无副作用 [@x380kkm 2026-06-14] ////
  stop() {
    if (this._unsub) { this._unsub(); this._unsub = null; }
  }

  //// 把一个边界态事件组装成反应提示词,交反应策略产出有界反应 [@x380kkm 2026-06-14] ////
  async _react(event) {
    if (!event || !this.reactionPolicy) return null;
    const scope = this.composeScope ? this.composeScope(event) : { messages: [] };
    return this.reactionPolicy.reactTo(event, scope);
  }
  //// /把一个边界态事件组装成反应提示词 ////
}

//// 反应失败时记录,有 console 才打,无则静默 [@x380kkm 2026-06-14] ////
function logReactError(error) {
  if (typeof console !== 'undefined' && typeof console.error === 'function') {
    console.error('[ReactionDriver] 驱动反应失败:', error && error.message ? error.message : error);
  }
}
//// /反应失败时记录 ////

module.exports = { ReactionDriver, STATE_REACTION_TYPE };
