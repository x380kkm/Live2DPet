// audience: internal
// # emotion-selector
// 到阈值后经有界 LLM 选情绪,产出语义动作名交渲染层。
// 不变量:本调用是事件驱动的有界调用,不每帧调;产物是语义动作名,不直接写渲染参数。

const UNIMPLEMENTED = '未实现,见目标架构设计第七节迁移里程碑';

class EmotionSelector {
  // state 为情绪状态,返回语义动作名
  select(state) {
    throw new Error(UNIMPLEMENTED);
  }
}

module.exports = { EmotionSelector };
