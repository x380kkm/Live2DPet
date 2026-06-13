// audience: internal
// # builtin-intents
// 出厂意图:观察回应、空闲闲聊两条核心意图的数据声明,供注册表加载。
// 不变量:出厂意图为纯数据声明;不含成品措辞、不含人格文本;情绪、焦点、反重复是上下文源开关而非意图。

const { intentFromDeclaration, TriggerWhen, ProductKind } = require('./intent');

//// 出厂意图来源标识 [@busybee 2026-06-13] ////
const BUILTIN_ORIGIN = 'builtin';

//// 观察回应:有视觉输入时纳入候选,引视觉记忆与态势上下文源 [@busybee 2026-06-13] ////
const OBSERVE_RESPONSE = {
  id: 'observe-response',
  trigger: { when: TriggerWhen.VisualInput },
  // 上下文源开关,情绪、焦点、反重复都在这里以引用列出,不是独立意图
  contextSourceRefs: [
    'situationDigest',
    'visualMemory',
    'focusInfo',
    'layoutInfo',
    'petPosition',
    'toneHint',
    'recentReplies',
  ],
  // 只引结构样例,语气样例按角色在解析期注入
  fewShotRefs: ['structure/observe-response'],
  product: { kind: ProductKind.UseTemplate, templateId: 'reply-bubble' },
};

//// 空闲闲聊:无输入时纳入候选,引空闲与反重复上下文源 [@busybee 2026-06-13] ////
const IDLE_CHAT = {
  id: 'idle-chat',
  trigger: { when: TriggerWhen.Idle },
  contextSourceRefs: ['idleInfo', 'focusInfo', 'toneHint', 'recentReplies'],
  fewShotRefs: ['structure/idle-chat'],
  product: { kind: ProductKind.UseTemplate, templateId: 'reply-bubble' },
};

//// 把两条出厂数据声明解析成意图实例,带来源可追溯 [@busybee 2026-06-13] ////
function builtinIntents() {
  return [
    intentFromDeclaration(OBSERVE_RESPONSE, BUILTIN_ORIGIN),
    intentFromDeclaration(IDLE_CHAT, BUILTIN_ORIGIN),
  ];
}
//// /把两条出厂数据声明解析成意图实例 ////

module.exports = { builtinIntents, BUILTIN_ORIGIN };
