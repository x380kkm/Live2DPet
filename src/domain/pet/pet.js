// audience: internal
// # pet
// 角色运行时编排器:在模型侧从候选意图里选一个,装配上下文源,调模型,把产物经事件总线发给表现层。
// 不变量:不持有窗口句柄、不直接调用 send;第三方能力一律经构造注入的接口访问。

const NOT_IMPLEMENTED = '未实现,见目标架构设计第七节迁移里程碑';

class PetOrchestrator {
  selectIntent(candidates, scope) {
    throw new Error(NOT_IMPLEMENTED);
  }

  run(intent) {
    throw new Error(NOT_IMPLEMENTED);
  }

  generateTempMod(intent) {
    throw new Error(NOT_IMPLEMENTED);
  }
}

module.exports = { PetOrchestrator };
