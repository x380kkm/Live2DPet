// audience: internal
// # pet
// 角色运行时编排器:在模型侧从候选意图里选一个,装配上下文源,调模型,把产物经事件总线发给表现层。
// 不变量:不持有窗口句柄、不直接调用 send;第三方能力一律经构造注入的接口访问。
// 不变量:generateTempMod 产物只含行为与前端,禁止写入人格或成品措辞。

const { StepId } = require('../../shared/step-catalog');
const { ProductKind } = require('../intent/intent');
const { describeModNeutrally } = require('./mod-introduction');

class PetOrchestrator {
  //// 构造注入意图来源、请求管线、模型客户端、事件总线 [@x380kkm 2026-06-13] ////
  // deps 形如:
  //   pipeline    请求管线,run(intent, scope) 返回回应三元组
  //   llmClient   平台 LLM 客户端,选意图这次有界小窗口调用经它发起
  //   eventBus    平台事件总线,产物经 publish 发出,编排器不持窗口句柄
  //   modGenerator  可选的 mod 生成器,当场生成临时 mod 这条路径用
  //   intentParser  把模型选意图的回应解析成意图 id 的函数,缺省取首个有效 id
  constructor(deps) {
    this.pipeline = deps.pipeline;
    this.llmClient = deps.llmClient;
    this.eventBus = deps.eventBus;
    this.modGenerator = deps.modGenerator || null;
    this.intentParser = deps.intentParser || defaultIntentParser;
  }

  //// 模型侧从候选意图里选一个:一次有界小窗口调用,只问选哪个 [@x380kkm 2026-06-13] ////
  // 无候选返回 null;只一条候选直接选它、不耗模型调用;否则把候选触发条件清单交模型选。
  async selectIntent(candidates, scope) {
    if (!candidates || candidates.length === 0) {
      return null;
    }
    if (candidates.length === 1) {
      return candidates[0];
    }

    const request = buildSelectionRequest(candidates, scope);
    const result = await this.llmClient.complete(request);
    const chosenId = this.intentParser(result.text, candidates);
    return candidates.find((intent) => intent.id === chosenId) || candidates[0];
  }
  //// /模型侧从候选意图里选一个 ////

  //// 跑一个意图:经管线产出回应,把产物经事件总线发出 [@x380kkm 2026-06-13] ////
  // 编排器只做编排:调管线、把回应折成发言产物事件发布,表现层订阅自取,不直接 send。
  async run(intent, scope) {
    // 产物为「当场生成临时 mod」时,走生成期一次性造前端并请求挂载,挂载后再产一句引入台词
    if (intent && intent.product && intent.product.kind === ProductKind.GenerateTempMod) {
      return this._runGenerateTempMod(intent, scope);
    }

    const response = await this.pipeline.run(intent, scope);
    if (!response || !response.text) {
      return null;
    }

    this.eventBus.publish({
      type: 'UtteranceProduced',
      intentId: intent.id,
      text: response.text,
      emotion: response.emotion,
      modEvents: response.modEvents
    });
    return response;
  }
  //// /跑一个意图 ////

  //// 生成临时 mod 后请求挂载,再据中性描述经富管线产一句引入台词 [@x380kkm 2026-06-14] ////
  // 引入台词由主模型据人格现场生成,只喂 mod 的中性行为描述,守住生成期不写措辞的隔离边界。
  async _runGenerateTempMod(intent, scope) {
    const mod = await this.generateTempMod(intent);
    if (!mod) return null;
    this.eventBus.publish({ type: 'ModMountRequested', modId: mod.id, frontendSpec: mod.frontendSpec, emits: mod.emits });

    const introScope = { ...(scope || {}), modIntroduction: describeModNeutrally(mod) };
    const response = this.pipeline ? await this.pipeline.run(intent, introScope) : null;
    if (response && response.text) {
      this.eventBus.publish({
        type: 'UtteranceProduced',
        intentId: intent.id,
        text: response.text,
        emotion: response.emotion,
        modEvents: []
      });
    }
    return { mod, response };
  }
  //// /生成临时 mod 后请求挂载并产引入台词 ////

  //// 生成期 LLM 一次性造临时 mod,守住隔离边界 [@x380kkm 2026-06-13] ////
  // 委托注入的 mod 生成器;生成器在代码层禁止往产物写人格或成品措辞,编排器只转交意图规格。
  async generateTempMod(intent) {
    if (!this.modGenerator) {
      throw new Error('未注入 mod 生成器,无法生成临时 mod');
    }
    return this.modGenerator.generate(intent.product && intent.product.spec);
  }
  //// /生成期 LLM 一次性造临时 mod ////
}

//// 把候选意图的触发条件清单拼成选意图请求 [@x380kkm 2026-06-13] ////
// 只交触发条件与 id 让模型选,不交成品措辞;一次问「选哪个意图」,是有界事件调用非每帧调。
function buildSelectionRequest(candidates, scope) {
  const lines = candidates.map((intent) => `${intent.id}: ${describeTrigger(intent.trigger)}`);
  const situation = (scope && scope.situationDigest) || '';
  return {
    // 意图与场景路由步:交模型路由按 intentRoute 步配置(默认温度 0,确定可复现)
    step: StepId.IntentRoute,
    messages: [
      { role: 'system', content: '从候选意图里选最合适的一个,只回意图 id。' },
      { role: 'user', content: `当前态势:${situation}\n候选意图:\n${lines.join('\n')}` }
    ]
  };
}

//// 把触发声明压成一行可读描述,缺省回退为字符串化 [@x380kkm 2026-06-13] ////
function describeTrigger(trigger) {
  if (!trigger) {
    return '';
  }
  if (typeof trigger === 'string') {
    return trigger;
  }
  return trigger.description || JSON.stringify(trigger);
}

//// 缺省意图解析:从回应文本里找第一个匹配的候选 id [@x380kkm 2026-06-13] ////
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

module.exports = { PetOrchestrator };
