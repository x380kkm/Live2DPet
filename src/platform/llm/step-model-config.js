// audience: internal
// # step-model-config
// 步骤模型配置解析:按大类与步骤两层就近覆盖,解析出某步该用的模型与调用参数。
// 不变量:模型身份(预设、端点、密钥、模型名)默认跟随大类、可经步骤开关单独覆盖;
// 行为参数(温度、最大 token 等)以步骤为先,故路由始终能保持 0 温度而不受大类温度牵连。
//
// 配置形如 { categories: { vlm|llm|translate: {...} }, steps: { 步骤 id: {...} }, systemInjection? }。
// 大类项含模型身份与可选行为默认;步骤项含 followCategory 开关与可选覆盖。
// resolve(stepId) 产出可直接铺到模型客户端的扁平配置。

const { STEP_CATEGORY, STEP_DEFAULTS } = require('../../shared/step-catalog');

// 模型身份字段:决定调哪个供应商的哪个模型,默认跟随大类。
const MODEL_FIELDS = ['preset', 'baseURL', 'apiKey', 'model'];
// 行为参数字段:决定这一步怎么调,以步骤为先。
const BEHAVIOR_FIELDS = ['temperature', 'maxTokens', 'effort', 'thinking'];

//// 取第一个有定义的值,都没有则 undefined [@busybee 2026-06-13] ////
function firstDefined(...values) {
  for (const value of values) {
    if (value !== undefined) {
      return value;
    }
  }
  return undefined;
}

//// 把全局、大类、步骤三处的 system 注入按非空顺序拼成一段 [@busybee 2026-06-13] ////
function mergeInjection(...texts) {
  return texts.filter((t) => typeof t === 'string' && t.length > 0).join('\n\n');
}

class StepModelConfig {
  //// 构造注入大类配置表、步骤覆盖表与全局 system 注入 [@busybee 2026-06-13] ////
  constructor(config = {}) {
    this.categories = config.categories || {};
    this.steps = config.steps || {};
    // 全局额外 system 注入:与各大类、各步骤的注入合并,空则忽略。
    this.systemInjection = config.systemInjection || '';
  }

  //// 解析某步该用的模型与参数:模型身份跟随大类、行为参数以步骤为先 [@busybee 2026-06-13] ////
  resolve(stepId) {
    const category = STEP_CATEGORY[stepId];
    if (!category) {
      throw new Error(`未知步骤 ${stepId},不在步骤目录内`);
    }
    const cat = this.categories[category] || {};
    const step = this.steps[stepId] || {};
    const defaults = STEP_DEFAULTS[stepId] || {};
    // 缺省跟随大类;显式置 false 才用步骤自己的模型身份。
    const followCategory = step.followCategory !== false;

    const resolved = { stepId, category, followCategory };

    // 模型身份:跟随大类则全取大类;否则步骤覆盖,步骤缺的字段回退大类。
    for (const field of MODEL_FIELDS) {
      resolved[field] = followCategory
        ? cat[field]
        : firstDefined(step[field], cat[field]);
    }
    // 行为参数:步骤覆盖 盖过 大类 盖过 出厂默认,使路由等步骤的固有温度不被大类设置牵连。
    for (const field of BEHAVIOR_FIELDS) {
      resolved[field] = firstDefined(step[field], cat[field], defaults[field]);
    }
    // 额外请求体字段:大类与步骤逐键合并,步骤盖大类,承载供应商特有字段。
    resolved.extraBody = { ...(cat.extraBody || {}), ...(step.extraBody || {}) };
    // system 注入:全局加大类加步骤,合并成一段,供提示词层与出厂提示词拼接。
    resolved.systemInjection = mergeInjection(this.systemInjection, cat.systemInjection, step.systemInjection);
    return resolved;
  }
  //// /解析某步该用的模型与参数 ////
}

module.exports = { StepModelConfig };
