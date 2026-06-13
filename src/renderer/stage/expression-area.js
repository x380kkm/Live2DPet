// audience: internal
// # expression-area
// 表达区:mod 前端与对话气泡是同一表达区的两个占用者,同一时刻至多一个占主导。
// 不变量:两占用者共用一块空间,主导权切换是排他的。

export class ExpressionArea {
  takeOver(occupant) {
    throw new Error('未实现,见目标架构设计第七节迁移里程碑');
  }

  release() {
    throw new Error('未实现,见目标架构设计第七节迁移里程碑');
  }
}
