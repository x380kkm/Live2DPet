// audience: internal
// # intent
// 意图数据结构:模型侧在运行期从可枚举意图集里选一个的纯数据声明,含触发条件、上下文源清单、few-shot 引用、产物声明。
// 不变量:纯数据无方法无副作用;不含成品措辞、不含人格文本。

//// 触发条件取值:有视觉输入、空闲、某个 mod 事件名 [@busybee 2026-06-13] ////
const TriggerWhen = {
  VisualInput: 'visual-input',
  Idle: 'idle',
  ModEvent: 'mod-event',
};

//// 产物形态取值:用某个模板,或当场生成临时 mod [@busybee 2026-06-13] ////
const ProductKind = {
  UseTemplate: 'use-template',
  GenerateTempMod: 'generate-temp-mod',
};

class Intent {
  constructor() {
    // 意图标识
    this.id = null;
    // 何时纳入候选,如有视觉输入、空闲、某个 mod 事件名
    this.trigger = null;
    // 按引用列出所需上下文源,不内联内容
    this.contextSourceRefs = [];
    // 只引结构样例,语气样例按角色解析
    this.fewShotRefs = [];
    // 产物声明:使用某个模板,或当场生成临时 mod
    this.product = null;
    // 来源标识:出厂内置或某个 mod 的 id,供发现可追溯
    this.origin = null;
  }
}

//// 从数据声明逐字段拷贝建意图,校验必填项,可追溯而非深反射 [@busybee 2026-06-13] ////
function intentFromDeclaration(declaration, origin) {
  if (!declaration || typeof declaration !== 'object') {
    throw new Error('意图声明必须是对象');
  }
  if (!declaration.id || typeof declaration.id !== 'string') {
    throw new Error('意图声明缺少字符串 id');
  }
  const trigger = declaration.trigger;
  if (!trigger || !Object.values(TriggerWhen).includes(trigger.when)) {
    throw new Error(`意图 ${declaration.id} 的 trigger.when 必须是 ${Object.values(TriggerWhen).join('、')} 之一`);
  }
  if (trigger.when === TriggerWhen.ModEvent && !trigger.event) {
    throw new Error(`意图 ${declaration.id} 的 mod-event 触发缺少 event 名`);
  }

  const intent = new Intent();
  intent.id = declaration.id;
  intent.trigger = { when: trigger.when };
  if (trigger.when === TriggerWhen.ModEvent) {
    intent.trigger.event = trigger.event;
  }
  intent.contextSourceRefs = Array.isArray(declaration.contextSourceRefs)
    ? declaration.contextSourceRefs.slice()
    : [];
  intent.fewShotRefs = Array.isArray(declaration.fewShotRefs)
    ? declaration.fewShotRefs.slice()
    : [];
  intent.product = declaration.product || null;
  intent.origin = origin || declaration.origin || null;
  return intent;
}
//// /从数据声明逐字段拷贝建意图 ////

module.exports = { Intent, TriggerWhen, ProductKind, intentFromDeclaration };
