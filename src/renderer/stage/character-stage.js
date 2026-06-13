// audience: internal
// # character-stage
// 统一角色表现层:单一透明覆盖窗口经 CSS 协调角色头部、mod 前端槽、对话气泡的布局。
// 不变量:除交互元素外整窗点击穿透;同一时刻 mod 槽与气泡至多一个占主导。

export class CharacterStage {
  mountHead(adapter) {
    throw new Error('未实现,见目标架构设计第七节迁移里程碑');
  }

  allocateModSlot(modId) {
    throw new Error('未实现,见目标架构设计第七节迁移里程碑');
  }

  showBubble(text) {
    throw new Error('未实现,见目标架构设计第七节迁移里程碑');
  }

  arbitrate() {
    throw new Error('未实现,见目标架构设计第七节迁移里程碑');
  }
}
