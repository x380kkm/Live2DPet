// audience: internal
// # emotion
// 情绪积累与阈值:纯状态推进,到阈值发事件。
// 不变量:本模块只推进状态并发事件,不直接播放表情或动作;输出经事件总线对外。

const UNIMPLEMENTED = '未实现,见目标架构设计第七节迁移里程碑';

class EmotionState {
  // 当前情绪态
  current = null;

  // 外部直喂情绪输入,推进状态
  feed(input) {
    throw new Error(UNIMPLEMENTED);
  }

  // 判定是否到达阈值
  hasReachedThreshold() {
    throw new Error(UNIMPLEMENTED);
  }
}

module.exports = { EmotionState };
