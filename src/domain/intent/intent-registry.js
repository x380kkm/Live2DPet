// audience: internal
// # intent-registry
// 意图发现与注入:从 mod 与角色的数据声明收集意图,供模型侧选择。
// 不变量:意图在加载或注册期被发现注入,不做运行时深反射扫描;同一 id 后注册者覆盖先注册者。

const { Intent, intentFromDeclaration, TriggerWhen } = require('./intent');

class IntentRegistry {
  constructor() {
    // 按 id 存已注册意图,保证可枚举且去重
    this._byId = new Map();
  }

  //// 注册一个已解析的意图实例,同 id 覆盖 [@busybee 2026-06-13] ////
  register(intent) {
    if (!intent || typeof intent.id !== 'string' || !intent.id) {
      throw new Error('注册的意图缺少字符串 id');
    }
    if (!intent.trigger || !Object.values(TriggerWhen).includes(intent.trigger.when)) {
      throw new Error(`意图 ${intent.id} 的 trigger.when 无效`);
    }
    this._byId.set(intent.id, intent);
    return intent;
  }
  //// /注册一个已解析的意图实例 ////

  //// 从出厂意图清单逐条发现注入 [@busybee 2026-06-13] ////
  discoverBuiltins(intents) {
    for (const intent of intents || []) {
      this.register(intent);
    }
  }
  //// /从出厂意图清单逐条发现注入 ////

  //// 从一组 mod 读其 intents 数据声明并注入,可追溯到 mod id [@busybee 2026-06-13] ////
  discoverFromMods(mods) {
    for (const mod of mods || []) {
      const declarations = mod && Array.isArray(mod.intents) ? mod.intents : [];
      for (const declaration of declarations) {
        // 已解析的意图实例直接注册,纯数据声明则按 mod id 解析后注册
        const intent = declaration instanceof Intent
          ? declaration
          : intentFromDeclaration(declaration, mod.id);
        this.register(intent);
      }
    }
  }
  //// /从一组 mod 读其 intents 数据声明并注入 ////

  //// 从角色的 intents 数据声明注入,可追溯到角色 id [@busybee 2026-06-13] ////
  discoverFromCharacter(character) {
    const declarations = character && Array.isArray(character.intents) ? character.intents : [];
    const origin = character && character.id ? `character:${character.id}` : 'character';
    for (const declaration of declarations) {
      this.register(intentFromDeclaration(declaration, origin));
    }
  }
  //// /从角色的 intents 数据声明注入 ////

  //// 列出当前作用域信号能触发的候选意图,情绪焦点反重复不参与触发 [@busybee 2026-06-13] ////
  candidates(scope) {
    const signals = (scope && scope.signals) || {};
    const result = [];
    for (const intent of this._byId.values()) {
      if (this._triggerMatches(intent.trigger, signals)) {
        result.push(intent);
      }
    }
    return result;
  }
  //// /列出当前作用域信号能触发的候选意图 ////

  //// 触发条件按信号匹配:有视觉输入、空闲、具名 mod 事件 [@busybee 2026-06-13] ////
  _triggerMatches(trigger, signals) {
    switch (trigger.when) {
      case TriggerWhen.VisualInput:
        return Boolean(signals.hasVisualInput);
      case TriggerWhen.Idle:
        return !signals.hasVisualInput;
      case TriggerWhen.ModEvent:
        return Array.isArray(signals.modEvents) && signals.modEvents.includes(trigger.event);
      default:
        return false;
    }
  }
  //// /触发条件按信号匹配 ////
}

module.exports = { IntentRegistry };
