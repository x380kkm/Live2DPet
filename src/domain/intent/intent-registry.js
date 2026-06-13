// audience: internal
// # intent-registry
// 意图发现与注入:从 mod 与角色的数据声明收集意图,供模型侧选择。
// 不变量:意图在加载或注册期被发现注入,不做运行时深反射扫描。

const NOT_IMPLEMENTED = '未实现,见目标架构设计第七节迁移里程碑';

class IntentRegistry {
  register(intent) {
    throw new Error(NOT_IMPLEMENTED);
  }

  candidates(scope) {
    throw new Error(NOT_IMPLEMENTED);
  }
}

module.exports = { IntentRegistry };
