// audience: internal
// # state-machine
// 通用有界状态机:维护当前状态,按输入转移,边界态产出反应事件向事件总线发布。
// 不变量:同一份当前状态既供算法侧步进又供反应侧映射,无额外对齐层。
//
// 依赖经构造注入:definition 给定状态集、初始态、转移表与边界态清单,deps.eventBus 给定事件总线。
// definition 形如 { initial, transitions, reactiveStates? }。
// transitions 是 { 状态名: { 输入名: 目标态名 } } 的纯数据声明,在加载期被发现注入,运行期不深反射。
// 转移成功向总线发布 { type: 'StateChanged', from, to, input };目标态属边界态时再发布
// { type: 'StateReaction', state, from, input } 供反应侧映射,本模块自身不调 LLM、不碰渲染。

class StateMachine {
  //// 从纯数据定义与注入的总线建立有界状态机 [@x380kkm 2026-06-13] ////
  constructor(definition, deps) {
    // 转移表只读:运行期按表查目标态,表外输入即越界。
    this._transitions = definition.transitions || {};
    // 边界态集合:进入这些态时额外发布反应事件。
    this._reactiveStates = new Set(definition.reactiveStates || []);
    this._eventBus = deps.eventBus;
    // 每个状态的进入处理器列表,转移落地后依次回调。
    this._enterHandlers = new Map();
    this._current = definition.initial;
  }

  get current() {
    return this._current;
  }

  //// 按输入查表转移,落地后发布状态事件并触发进入处理器,无定义则不动 [@x380kkm 2026-06-13] ////
  transition(input) {
    const outgoing = this._transitions[this._current];
    const next = outgoing ? outgoing[input] : undefined;
    // 表外输入:状态机保持有界,原地不动且不发事件。
    if (next === undefined) {
      return false;
    }

    const from = this._current;
    this._current = next;
    this._eventBus.publish({ type: 'StateChanged', from, to: next, input });
    // 边界态额外发布反应事件,交反应侧映射成有界 LLM 调用。
    if (this._reactiveStates.has(next)) {
      this._eventBus.publish({ type: 'StateReaction', state: next, from, input });
    }
    this._runEnterHandlers(next, { from, input });
    return true;
  }
  //// /按输入查表转移,落地后发布状态事件并触发进入处理器,无定义则不动 ////

  //// 为某状态登记进入处理器,返回注销函数 [@x380kkm 2026-06-13] ////
  onEnter(state, handler) {
    let handlers = this._enterHandlers.get(state);
    if (!handlers) {
      handlers = [];
      this._enterHandlers.set(state, handlers);
    }
    handlers.push(handler);
    return () => this._removeEnterHandler(state, handler);
  }

  //// 依次调用某状态的全部进入处理器 [@x380kkm 2026-06-13] ////
  _runEnterHandlers(state, context) {
    const handlers = this._enterHandlers.get(state);
    if (!handlers) {
      return;
    }
    // 复制一份再遍历,使处理器内的注销不打断本次回调。
    for (const handler of handlers.slice()) {
      handler(context);
    }
  }

  //// 从某状态的进入处理器列表移除一个处理器 [@x380kkm 2026-06-13] ////
  _removeEnterHandler(state, handler) {
    const handlers = this._enterHandlers.get(state);
    if (!handlers) {
      return;
    }
    const index = handlers.indexOf(handler);
    if (index !== -1) {
      handlers.splice(index, 1);
    }
    if (handlers.length === 0) {
      this._enterHandlers.delete(state);
    }
  }
}

module.exports = { StateMachine };
