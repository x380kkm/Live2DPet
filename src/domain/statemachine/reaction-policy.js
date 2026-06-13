// audience: internal
// # reaction-policy
// 有界事件驱动反应:把状态机的边界态事件映射成有界 LLM 调用,产出角色反应。
// 不变量:反应由事件触发、不每帧调用;映射只读状态事件,不直接驱动渲染。
//
// 依赖经构造注入:deps.llmClient 给定有界 LLM 客户端(只用其 complete),deps.eventBus 给定事件总线。
// scope 由调用方供内容:scope.messages 是结构化提示词消息,本模块只搭结构不含成品措辞与人格文本。
// 取消语义借自 message-session:每次 reactTo 自增调用号,后发的调用作废先前在途的,只有最新一次发布产物。
// 产出向总线发布 { type: 'ReactionProduced', state, text };作废或空文本不发布。

const { StepId } = require('../../shared/step-catalog');

class ReactionPolicy {
  //// 从注入的 LLM 客户端与总线建立有界反应策略 [@busybee 2026-06-13] ////
  constructor(deps) {
    this._llmClient = deps.llmClient;
    this._eventBus = deps.eventBus;
    // 当前调用号:每次 reactTo 自增,在途调用据此判定自己是否仍是最新。
    this._currentCall = 0;
  }

  //// 把一个边界态事件映射成一次有界 LLM 调用,只让最新一次的产物发布 [@busybee 2026-06-13] ////
  async reactTo(event, scope) {
    const callId = ++this._currentCall;

    let result;
    try {
      // 事件反应步:交模型路由按 reaction 步配置(默认温度 1.3)
      result = await this._llmClient.complete({ messages: scope.messages, step: StepId.Reaction });
    } catch (error) {
      // 调用失败不发布产物,只让上层经返回的失败标记感知。
      return { produced: false, reason: 'failed', error };
    }

    // 后发调用已自增调用号,本次在途调用作废,不发布产物。
    if (callId !== this._currentCall) {
      return { produced: false, reason: 'superseded' };
    }

    const text = result.text ? result.text.trim() : '';
    if (!text) {
      return { produced: false, reason: 'empty' };
    }

    this._eventBus.publish({ type: 'ReactionProduced', state: event.state, text });
    return { produced: true, text };
  }
  //// /把一个边界态事件映射成一次有界 LLM 调用,只让最新一次的产物发布 ////
}

module.exports = { ReactionPolicy };
