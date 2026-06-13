// audience: internal
// # response-cleaner
// 把特定模型的输出怪癖(如 think 标签)剥离在这一处,客户端其余部分不感知。
// 不变量:只清理文本怪癖,不改变语义内容,不依赖任何供应商类型。

function cleanResponse(rawText) {
  throw new Error('未实现,见目标架构设计第七节迁移里程碑');
}

module.exports = { cleanResponse };
