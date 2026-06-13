// audience: internal
// # live2d-renderer
// RenderAdapter 的 Live2D 实现:PIXI 与 Cubism 的私有字段访问全部收在此一文件。
// 不变量:Cubism 私有字段不外泄给本文件以外的任何模块。

class Live2dRenderer {
  // 按语义动作名播放,内部映射到 Cubism 的 motion 或 expression。
  playAction(name) {
    throw new Error('未实现,见目标架构设计第七节迁移里程碑');
  }

  // 设置口型开合度,内部写入 Cubism 模型参数。
  setMouth(openness) {
    throw new Error('未实现,见目标架构设计第七节迁移里程碑');
  }

  // 命中测试,返回被点中的交互区或空。
  hitTest(point) {
    throw new Error('未实现,见目标架构设计第七节迁移里程碑');
  }

  // 释放 PIXI 与 Cubism 资源。
  dispose() {
    throw new Error('未实现,见目标架构设计第七节迁移里程碑');
  }
}

module.exports = { Live2dRenderer };
