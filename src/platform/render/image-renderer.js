// audience: internal
// # image-renderer
// RenderAdapter 的图片实现:默认走 Live2D 时不加载;分帧与口型为可选后置增强。
// 不变量:与 Live2D 实现共用同一套语义动作名,不引入任何 Live2D 或 Cubism 类型。

class ImageRenderer {
  // 按语义动作名切换图片帧。
  playAction(name) {
    throw new Error('未实现,见目标架构设计第七节迁移里程碑');
  }

  // 设置口型开合度,内部映射到对应口型帧。
  setMouth(openness) {
    throw new Error('未实现,见目标架构设计第七节迁移里程碑');
  }

  // 命中测试,返回被点中的交互区或空。
  hitTest(point) {
    throw new Error('未实现,见目标架构设计第七节迁移里程碑');
  }

  // 释放图片资源。
  dispose() {
    throw new Error('未实现,见目标架构设计第七节迁移里程碑');
  }
}

module.exports = { ImageRenderer };
