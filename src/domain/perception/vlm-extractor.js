// audience: internal
// # vlm-extractor
// 从关键帧选取与解析态势:只做态势抽取一件事,输出桌面态势摘要。
// 不变量:内部那次关键帧选择的大模型调用受自身退避区间约束,不进角色反应链。

const UNIMPLEMENTED = '未实现,见目标架构设计第七节迁移里程碑';

class VlmExtractor {
  // frames 为关键帧集,返回桌面态势摘要
  extract(frames) {
    throw new Error(UNIMPLEMENTED);
  }
}

module.exports = { VlmExtractor };
