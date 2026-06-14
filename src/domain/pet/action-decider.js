// audience: internal
// # action-decider
// 动作决策器:从候选意图里定下一个动作并产出回应,把「选哪个」与「怎么说」封成一条可替换的策略。
// 不变量:决策器不持窗口句柄;占比描述与建议只进意图选择提示词、不进主 LLM 的人格上下文;两种策略同进同出可互换。
//
// 两种策略对照:
//   拆分策略 SplitIntentDecider:先用意图路由步的轻量模型按占比描述选一个意图,再用台词步的主模型产回应,两次调用。
//   合并策略 MainLlmDecider:把候选清单与占比描述一并塞进台词步的主模型,一次调用既选意图又产回应。
// 两者都接收 weightModel 与 sampler 算出的选择简报,区别只在调用结构与提示词大小,供仿真对比择优。

const { StepId } = require('../../shared/step-catalog');
const { identityMask } = require('./action-mask');

//// 缺省意图解析:从回应文本里找第一个出现的候选 id [@busybee 2026-06-14] ////
function defaultIntentParser(text, candidates) {
  if (!text) {
    return null;
  }
  for (const intent of candidates) {
    if (text.includes(intent.id)) {
      return intent.id;
    }
  }
  return null;
}
//// /缺省意图解析 ////

//// 把候选意图压成「id: 触发描述」清单,供选择提示词列出 [@busybee 2026-06-14] ////
function listCandidates(candidates) {
  return candidates
    .map((intent) => {
      const trigger = intent.trigger;
      const desc = !trigger ? '' : typeof trigger === 'string' ? trigger : trigger.when || '';
      return `${intent.id}: ${desc}`;
    })
    .join('\n');
}
//// /把候选意图压成清单 ////

class SplitIntentDecider {
  //// 构造注入模型、权重模型、低差异采样器、上下文构造与意图解析 [@busybee 2026-06-14] ////
  // deps.llm.complete({ step, messages }) 返回 { text };buildContext(intent, scope) 返回该意图的上下文文本。
  constructor(deps) {
    this.llm = deps.llm;
    this.weightModel = deps.weightModel;
    this.sampler = deps.sampler || null;
    this.buildContext = deps.buildContext;
    this.intentParser = deps.intentParser || defaultIntentParser;
    this.mask = deps.mask || identityMask;
  }
  //// /构造注入 ////

  //// 先按占比描述选意图,再产回应:无候选返回空,单候选省去选择调用 [@busybee 2026-06-14] ////
  async decide(candidates, scope) {
    const actions = this.mask(candidates, scope);
    if (!actions || actions.length === 0) {
      return { intent: null, response: null };
    }
    const emotion = (scope && scope.emotion) || 0;
    const brief = this.weightModel.brief(actions, emotion, this.sampler);

    const intent = actions.length === 1
      ? actions[0]
      : await this._select(actions, scope, brief);

    const response = await this._produce(intent, scope);
    return { intent, response };
  }
  //// /先按占比描述选意图,再产回应 ////

  //// 用意图路由步的轻量模型选一个意图 [@busybee 2026-06-14] ////
  async _select(candidates, scope, brief) {
    const situation = (scope && scope.situationDigest) || '';
    const request = {
      step: StepId.IntentRoute,
      messages: [
        { role: 'system', content: '从候选动作里选最合适的一个,只回动作 id。' },
        { role: 'user', content: `当前态势:${situation}\n${brief.description}\n建议动作:${brief.suggestedId}\n候选动作:\n${listCandidates(candidates)}` }
      ]
    };
    const result = await this.llm.complete(request);
    const chosenId = this.intentParser(result.text, candidates);
    return candidates.find((intent) => intent.id === chosenId) || candidates[0];
  }
  //// /用意图路由步的轻量模型选一个意图 ////

  //// 用台词步的主模型据上下文产一句回应 [@busybee 2026-06-14] ////
  async _produce(intent, scope) {
    const context = this.buildContext ? this.buildContext(intent, scope) : '';
    const request = {
      step: StepId.Dialogue,
      messages: [
        { role: 'system', content: '据上下文产出一句符合人格的话。' },
        { role: 'user', content: context }
      ]
    };
    const result = await this.llm.complete(request);
    return { text: result.text, intentId: intent.id };
  }
  //// /用台词步的主模型据上下文产一句回应 ////
}

class MainLlmDecider {
  //// 构造注入模型、权重模型、低差异采样器、上下文构造与意图解析 [@busybee 2026-06-14] ////
  constructor(deps) {
    this.llm = deps.llm;
    this.weightModel = deps.weightModel;
    this.sampler = deps.sampler || null;
    this.buildContext = deps.buildContext;
    this.intentParser = deps.intentParser || defaultIntentParser;
    this.mask = deps.mask || identityMask;
  }
  //// /构造注入 ////

  //// 一次调用既选意图又产回应:首行声明选中的动作 id,其后是这句话 [@busybee 2026-06-14] ////
  async decide(candidates, scope) {
    const actions = this.mask(candidates, scope);
    if (!actions || actions.length === 0) {
      return { intent: null, response: null };
    }
    if (actions.length === 1) {
      return this._produceOnly(actions[0], scope);
    }

    const emotion = (scope && scope.emotion) || 0;
    const brief = this.weightModel.brief(actions, emotion, this.sampler);
    const situation = (scope && scope.situationDigest) || '';
    const context = this.buildContext ? this.buildContext(null, scope) : '';
    const request = {
      step: StepId.Dialogue,
      messages: [
        { role: 'system', content: '从候选动作里选一个并直接产出这句话。第一行写「ACTION: 动作id」,其后写这句话。' },
        { role: 'user', content: `当前态势:${situation}\n上下文:${context}\n${brief.description}\n建议动作:${brief.suggestedId}\n候选动作:\n${listCandidates(actions)}` }
      ]
    };
    const result = await this.llm.complete(request);
    return this._split(result.text, actions);
  }
  //// /一次调用既选意图又产回应 ////

  //// 单候选时省去选择,只产回应 [@busybee 2026-06-14] ////
  async _produceOnly(intent, scope) {
    const context = this.buildContext ? this.buildContext(intent, scope) : '';
    const request = {
      step: StepId.Dialogue,
      messages: [
        { role: 'system', content: '据上下文产出一句符合人格的话。' },
        { role: 'user', content: context }
      ]
    };
    const result = await this.llm.complete(request);
    return { intent, response: { text: result.text, intentId: intent.id } };
  }
  //// /单候选时省去选择 ////

  //// 从合并回应里拆出选中的意图与这句话:首行 ACTION 给意图,其余为话 [@busybee 2026-06-14] ////
  _split(text, candidates) {
    const raw = text || '';
    const newlineAt = raw.indexOf('\n');
    const head = newlineAt >= 0 ? raw.slice(0, newlineAt) : raw;
    const body = newlineAt >= 0 ? raw.slice(newlineAt + 1).trim() : '';
    const chosenId = this.intentParser(head, candidates);
    const intent = candidates.find((item) => item.id === chosenId) || candidates[0];
    return { intent, response: { text: body || raw.trim(), intentId: intent.id } };
  }
  //// /从合并回应里拆出选中的意图与这句话 ////
}

module.exports = { SplitIntentDecider, MainLlmDecider, defaultIntentParser, listCandidates };
