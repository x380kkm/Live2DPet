// audience: internal
// # mod-registry
// mod 的发现与启用:合并全局默认启用与角色额外开启两级。
// 不变量:两级启用在此一处合并;mod 整合前先过用户数据与系统行为隔离边界。
//
// 依赖经构造注入:source 是 mod 仓储(实现 list 返回 mod 规格数组),
// globalEnabled 是全局默认启用的 mod id 集合,characterExtra 按角色 id 给出额外开启的 id 集合。
// discover 把仓储里的规格物化成 Mod 实例并按 id 建索引;
// enabledFor 把全局默认与某角色的额外开启两级合并成该角色实际启用的 mod 列表。

const { Mod } = require('./mod');

class ModRegistry {
  //// 构造注入 mod 仓储与两级启用声明 [@busybee 2026-06-13] ////
  // deps.source 提供 list();deps.globalEnabled 是全局默认启用 id 数组;
  // deps.characterExtra 是 { characterId: [modId] } 的角色额外开启表。
  constructor(deps) {
    const config = deps || {};
    this._source = config.source;
    this._globalEnabled = Array.isArray(config.globalEnabled) ? config.globalEnabled.slice() : [];
    this._characterExtra = config.characterExtra || {};
    // id 到已物化 Mod 实例的索引,discover 后填充。
    this._byId = new Map();
  }

  //// 从仓储发现 mod 规格并物化成按 id 索引的 Mod 实例 [@busybee 2026-06-13] ////
  discover() {
    this._byId.clear();
    const specs = this._source.list();
    for (const spec of specs) {
      const mod = new Mod(spec);
      if (mod.id) {
        this._byId.set(mod.id, mod);
      }
    }
    return [...this._byId.values()];
  }

  //// 合并全局默认与角色额外开启,返回该角色实际启用的 mod 列表 [@busybee 2026-06-13] ////
  // 两级启用只在此一处合并;以发现到的 id 为准,未发现的启用 id 直接跳过。
  enabledFor(characterId) {
    const extra = this._characterExtra[characterId] || [];
    const enabledIds = this._mergeEnabledIds(this._globalEnabled, extra);
    const enabled = [];
    for (const id of enabledIds) {
      const mod = this._byId.get(id);
      if (mod) {
        enabled.push(mod);
      }
    }
    return enabled;
  }
  //// /合并全局默认与角色额外开启 ////

  //// 把全局默认与角色额外两级 id 并集成有序去重清单 [@busybee 2026-06-13] ////
  // 保留全局默认在前、角色额外在后的顺序,重复 id 只取首次出现。
  _mergeEnabledIds(globalIds, extraIds) {
    const merged = [];
    const seen = new Set();
    for (const id of [...globalIds, ...extraIds]) {
      if (!seen.has(id)) {
        seen.add(id);
        merged.push(id);
      }
    }
    return merged;
  }
}

module.exports = { ModRegistry };
