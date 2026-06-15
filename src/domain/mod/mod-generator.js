// audience: internal
// # mod-generator
// mod 生成器:生成期 LLM 造前端与行为,产出一份 mod 模板。
// 不变量:产物只含行为与前端,禁止写入人格或成品措辞,守住用户数据与系统行为隔离边界。
//
// 依赖经构造注入:llm 是统一 LLM 客户端(实现 complete(request) 返回 { text }),
// parseSpec 把模型文本解析成 mod 规格纯数据。generate 拿一份生成意图 spec,
// 用只示范结构的 few-shot 提示模型造出前端与交互行为,再过一道隔离校验:
// 产物里出现人格描述或成品措辞即拒绝,绝不让生成期写进角色文风。

const { Mod } = require('./mod');
const { StepId } = require('../../shared/step-catalog');

// few-shot 只示范产物结构,字段值全为占位,不含任何成品句子或人格描述。
const STRUCTURE_FEWSHOT = Object.freeze({
  id: '<mod-id>',
  frontendSpec: { html: '<占位标记>', css: '<占位样式>', js: '<占位脚本>', sandboxed: true },
  emits: ['<事件名>'],
  intents: [{ id: '<intent-id>', trigger: '<事件名>', contextSourceRefs: [], fewShotRefs: [], product: null }],
  hostApi: ['<宿主方法名>']
});

// 成品措辞与人格的禁写标记:出现这些字段名即视为越界写入文风。
const FORBIDDEN_KEYS = Object.freeze(['persona', 'personality', 'character', 'tone', 'voice', 'phrase', 'phrases', 'lines', 'dialogue', 'wording', 'speech']);

class ModGenerator {
  //// 构造注入 LLM 客户端与规格解析器 [@x380kkm 2026-06-13] ////
  // deps.llm 实现 complete(request);deps.parseSpec(text) 把模型文本解析成 mod 规格对象。
  constructor(deps) {
    const config = deps || {};
    this._llm = config.llm;
    this._parseSpec = config.parseSpec || JSON.parse;
  }

  //// 据生成意图请模型造前端与行为,校验隔离后物化成 mod [@x380kkm 2026-06-13] ////
  // spec 描述要生成什么样的交互;返回一个 Mod 实例,产物含人格或成品措辞则抛错拒绝。
  async generate(spec) {
    const request = this._buildRequest(spec);
    const result = await this._llm.complete(request);
    const produced = this._parseSpec(result.text);
    this._assertNoFinishedWording(produced);
    return new Mod(produced);
  }

  //// 用只示范结构的 few-shot 组装生成请求 [@x380kkm 2026-06-13] ////
  // 提示词只交代产物字段与结构样例,明确禁止写入人格与成品措辞。
  _buildRequest(spec) {
    const system =
      '你是 mod 前端与交互行为的生成器。只产出前端规格与交互事件行为,' +
      '禁止写入任何人格、语气、成品台词或对白。严格按给定结构输出纯数据。';
    const structureExample = JSON.stringify(STRUCTURE_FEWSHOT);
    const user = `结构样例(仅示范字段与形状,值为占位):${structureExample}\n生成意图:${JSON.stringify(spec)}`;
    return {
      // mod 生成步:生成期一次性调用,交模型路由按 modGenerate 步配置(可单独换更强模型)
      step: StepId.ModGenerate,
      messages: [
        { role: 'system', content: system },
        { role: 'user', content: user }
      ]
    };
  }

  //// 校验产物不含人格或成品措辞,越界即抛错 [@x380kkm 2026-06-13] ////
  // 递归检查每层键名:命中禁写键即判定写入了文风,拒绝整份产物。
  _assertNoFinishedWording(produced) {
    if (this._containsForbiddenKey(produced)) {
      throw new Error('mod 生成产物含人格或成品措辞,拒绝写入');
    }
  }

  //// 递归判断数据里是否出现任一禁写键名 [@x380kkm 2026-06-13] ////
  _containsForbiddenKey(value) {
    if (Array.isArray(value)) {
      return value.some((item) => this._containsForbiddenKey(item));
    }
    if (value && typeof value === 'object') {
      for (const key of Object.keys(value)) {
        if (FORBIDDEN_KEYS.includes(key.toLowerCase())) {
          return true;
        }
        if (this._containsForbiddenKey(value[key])) {
          return true;
        }
      }
    }
    return false;
  }
}

module.exports = { ModGenerator, STRUCTURE_FEWSHOT, FORBIDDEN_KEYS };
