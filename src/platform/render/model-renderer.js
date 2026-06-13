// audience: internal
// # render
// 渲染适配层的公共接口:RenderAdapter 用语义化方法屏蔽底层渲染库差异。
// 不变量:对外只暴露语义动作名,PIXI 与 Cubism 私有字段访问全部收在 live2d-renderer 一处,不外泄;
// Live2D 实现与图片实现共用本接口。

class RenderAdapter {
  // 按语义动作名播放,内部映射到 motion 或 expression。
  playAction(name) {
    throw new Error('未实现,见目标架构设计第七节迁移里程碑');
  }

  // 设置口型开合度,取值 0 到 1,内部封装参数写入。
  setMouth(openness) {
    throw new Error('未实现,见目标架构设计第七节迁移里程碑');
  }

  // 命中测试,返回被点中的交互区或空。
  hitTest(point) {
    throw new Error('未实现,见目标架构设计第七节迁移里程碑');
  }

  // 释放渲染资源。
  dispose() {
    throw new Error('未实现,见目标架构设计第七节迁移里程碑');
  }
}

module.exports = { RenderAdapter };
