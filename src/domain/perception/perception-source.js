// audience: internal
// # perception
// 感知作为上下文源接入请求管线:屏蔽采集细节,只产出命名的上下文片段。
// 不变量:感知器不直接拼提示词,产物以命名上下文源经注册表登记;采集节奏与角色反应链相互独立。

const UNIMPLEMENTED = '未实现,见目标架构设计第七节迁移里程碑';

class PerceptionSource {
  // 上下文源标识
  id = 'perception';
  // 排序优先级
  priority = 0;

  estimateTokens() {
    throw new Error(UNIMPLEMENTED);
  }

  // scope 为 ResolvedScope,返回 ContextFragment 或 null
  render(scope) {
    throw new Error(UNIMPLEMENTED);
  }
}

module.exports = { PerceptionSource };
