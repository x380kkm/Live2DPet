// audience: internal
// # reaction-policy
// 有界事件驱动反应:把状态机的边界态事件映射成有界 LLM 调用,产出角色反应。
// 不变量:反应由事件触发、不每帧调用;映射只读状态事件,不直接驱动渲染。

const NOT_IMPLEMENTED = '未实现,见目标架构设计第七节迁移里程碑';

class ReactionPolicy {
  reactTo(event, scope) {
    throw new Error(NOT_IMPLEMENTED);
  }
}

module.exports = { ReactionPolicy };
