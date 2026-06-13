// audience: internal
// # channel-registry
// 进程间通信通道契约的单一来源:通道名可枚举、可校验、按能力域分级。
// 不变量:两侧不再各写裸字符串,所有通道名只在本文件声明。

function channels() {
  throw new Error('未实现,见目标架构设计第七节迁移里程碑');
}

function isKnown(channelName) {
  throw new Error('未实现,见目标架构设计第七节迁移里程碑');
}

function capabilityDomainOf(channelName) {
  throw new Error('未实现,见目标架构设计第七节迁移里程碑');
}

module.exports = { channels, isKnown, capabilityDomainOf };
