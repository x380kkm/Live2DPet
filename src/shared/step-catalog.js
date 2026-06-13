// audience: internal
// # step-catalog
// AI 步骤目录:用到模型的每一步的单一事实来源,定义大类、步骤 id、步骤归属大类与各步默认参数。
// 不变量:各调用点与设置界面都引用本表的步骤 id,字符串不散落;每个步骤恰属一个大类。
// 放在 shared 层:platform 的路由与翻译、domain 的各服务都引用它,故不能落在 domain。
//
// 大类(category)是「换哪个模型」的粒度:vlm 看截图、llm 文本、translate 翻译。
// 步骤(step)是「这一步怎么调」的粒度:同属 llm 的台词与路由用同一模型,但温度等行为各异。
// 默认参数里温度、最大 token 是步骤固有的(路由必须 0、台词要 1.3),与用哪个模型无关。

// 三个大类:换模型的粒度。
const Category = Object.freeze({
  Vlm: 'vlm',
  Llm: 'llm',
  Translate: 'translate'
});

// 八个步骤:调模型的具体落点。
const StepId = Object.freeze({
  KeyframeSelect: 'keyframeSelect',
  SituationExtract: 'situationExtract',
  Dialogue: 'dialogue',
  IntentRoute: 'intentRoute',
  EmotionSelect: 'emotionSelect',
  Reaction: 'reaction',
  ModGenerate: 'modGenerate',
  Translate: 'translate'
});

// 每个步骤归属哪个大类:followCategory 为真时据此取大类模型。
const STEP_CATEGORY = Object.freeze({
  [StepId.KeyframeSelect]: Category.Vlm,
  [StepId.SituationExtract]: Category.Vlm,
  [StepId.Dialogue]: Category.Llm,
  [StepId.IntentRoute]: Category.Llm,
  [StepId.EmotionSelect]: Category.Llm,
  [StepId.Reaction]: Category.Llm,
  [StepId.ModGenerate]: Category.Llm,
  [StepId.Translate]: Category.Translate
});

// 每个步骤的固有默认行为参数:温度与最大 token 由步骤目的决定,与所选模型无关。
// 路由与情绪选择要确定,故温度 0;台词与反应要新鲜不照抄,故温度 1.3;翻译低温稳定;
// mod 生成是结构化产物,低温且放宽 token;态势抽取需描述,留中等 token。
const STEP_DEFAULTS = Object.freeze({
  [StepId.KeyframeSelect]: { temperature: 0.0, maxTokens: 64 },
  [StepId.SituationExtract]: { temperature: 0.4, maxTokens: 400 },
  [StepId.Dialogue]: { temperature: 1.3, maxTokens: 200 },
  [StepId.IntentRoute]: { temperature: 0.0, maxTokens: 32 },
  [StepId.EmotionSelect]: { temperature: 0.0, maxTokens: 32 },
  [StepId.Reaction]: { temperature: 1.3, maxTokens: 200 },
  [StepId.ModGenerate]: { temperature: 0.2, maxTokens: 2048 },
  [StepId.Translate]: { temperature: 0.3, maxTokens: 1024 }
});

// 每个步骤给用户看的中文标签:设置界面据此列出可配置步骤。
const STEP_LABEL = Object.freeze({
  [StepId.KeyframeSelect]: '关键帧选择',
  [StepId.SituationExtract]: '态势抽取',
  [StepId.Dialogue]: '台词生成',
  [StepId.IntentRoute]: '意图与场景路由',
  [StepId.EmotionSelect]: '情绪选择',
  [StepId.Reaction]: '事件反应',
  [StepId.ModGenerate]: 'mod 生成',
  [StepId.Translate]: '翻译'
});

//// 列出出厂步骤声明,供步骤注册表在加载期发现注入 [@busybee 2026-06-13] ////
// 每条形如 { id, category, label, defaults },是 UI 枚举与配置解析的共同来源。
function builtinSteps() {
  return Object.values(StepId).map((id) => ({
    id,
    category: STEP_CATEGORY[id],
    label: STEP_LABEL[id],
    defaults: STEP_DEFAULTS[id]
  }));
}

module.exports = { Category, StepId, STEP_CATEGORY, STEP_DEFAULTS, STEP_LABEL, builtinSteps };
