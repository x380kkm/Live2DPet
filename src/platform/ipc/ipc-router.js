// audience: internal
// # ipc-router
// 主进程侧统一注册与分发进程间通信,收敛 try/catch 与存活判断样板。
// 不变量:通道名只来自 channel-registry,本文件不写裸字符串。

function register(channelName, handler) {
  throw new Error('未实现,见目标架构设计第七节迁移里程碑');
}

function dispatch(channelName, payload) {
  throw new Error('未实现,见目标架构设计第七节迁移里程碑');
}

module.exports = { register, dispatch };
