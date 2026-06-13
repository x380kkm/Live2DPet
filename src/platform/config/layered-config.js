// audience: internal
// # layered-config
// 三层配置(全局、角色、意图)合并解析器:就近覆盖向上回退,各键锁定层在此声明。
// 不变量:查找到的层若低于某键的 floor 则该层的值无效;三层都是不可变纯数据快照。

class ScopeResolver {
  resolve(key, characterId, intentId) {
    throw new Error('未实现,见目标架构设计第七节迁移里程碑');
  }

  lockedLayer(key) {
    throw new Error('未实现,见目标架构设计第七节迁移里程碑');
  }
}

class ResolvedScope {
  constructor() {
    // 全局层:这台机器与这个用户的设置
    this.global = null;
    // 角色层:这个角色怎么表现
    this.character = null;
    // 意图层:这个意图这一次怎么回应
    this.intent = null;
  }
}

module.exports = { ScopeResolver, ResolvedScope };
