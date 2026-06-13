// audience: internal
// # mod-frontend-slot
// mod 前端槽:经 sandbox-host 嵌入可执行前端,管插入与切换动画。
// 不变量:前端经沙箱宿主嵌入,槽本身不直接持有原始能力网关。

export class ModFrontendSlot {
  embed(frontendSpec) {
    throw new Error('未实现,见目标架构设计第七节迁移里程碑');
  }

  switchTo(frontendSpec) {
    throw new Error('未实现,见目标架构设计第七节迁移里程碑');
  }

  clear() {
    throw new Error('未实现,见目标架构设计第七节迁移里程碑');
  }
}
