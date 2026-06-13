// audience: internal
// # step-registry
// AI 步骤发现与注入:把用到模型的步骤声明收集成可枚举列表,供设置界面与配置校验用。
// 不变量:步骤在加载或注册期被发现注入,不做运行时深反射扫描;同一 id 后注册者覆盖先注册者。
//
// 与 intent-registry 同构:构造期发现注入、Map 按 id 去重、list 可枚举。
// mod 将来注册自己的 AI 步骤时走 discoverFromMods,与意图的反射注入式注册一致。

const { Category } = require('../../shared/step-catalog');

const VALID_CATEGORIES = new Set(Object.values(Category));

class StepRegistry {
  constructor() {
    // 按 id 存已注册步骤,保证可枚举且去重
    this._byId = new Map();
  }

  //// 注册一条步骤声明,校验 id 与大类合法,同 id 覆盖 [@busybee 2026-06-13] ////
  register(step) {
    if (!step || typeof step.id !== 'string' || !step.id) {
      throw new Error('注册的步骤缺少字符串 id');
    }
    if (!VALID_CATEGORIES.has(step.category)) {
      throw new Error(`步骤 ${step.id} 的大类 ${step.category} 不合法`);
    }
    this._byId.set(step.id, step);
    return step;
  }
  //// /注册一条步骤声明 ////

  //// 从出厂步骤清单逐条发现注入 [@busybee 2026-06-13] ////
  discoverBuiltins(steps) {
    for (const step of steps || []) {
      this.register(step);
    }
  }

  //// 从一组 mod 读其 aiSteps 数据声明并注入,可追溯到 mod id [@busybee 2026-06-13] ////
  discoverFromMods(mods) {
    for (const mod of mods || []) {
      const declarations = mod && Array.isArray(mod.aiSteps) ? mod.aiSteps : [];
      for (const declaration of declarations) {
        this.register({ ...declaration, origin: `mod:${mod.id}` });
      }
    }
  }

  //// 取一条已注册步骤,未命中返回 null [@busybee 2026-06-13] ////
  get(id) {
    return this._byId.get(id) || null;
  }

  //// 列出全部已注册步骤,供界面枚举与配置校验 [@busybee 2026-06-13] ////
  list() {
    return [...this._byId.values()];
  }
}

module.exports = { StepRegistry };
