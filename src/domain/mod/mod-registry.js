// audience: internal
// # mod-registry
// mod 的发现与启用:合并全局默认启用与角色额外开启两级。
// 不变量:两级启用在此一处合并;mod 整合前先过用户数据与系统行为隔离边界。

const NOT_IMPLEMENTED = '未实现,见目标架构设计第七节迁移里程碑';

class ModRegistry {
  discover() {
    throw new Error(NOT_IMPLEMENTED);
  }

  enabledFor(characterId) {
    throw new Error(NOT_IMPLEMENTED);
  }
}

module.exports = { ModRegistry };
