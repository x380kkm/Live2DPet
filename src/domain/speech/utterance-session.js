// audience: internal
// # utterance-session
// 发言会话:可被外部直接调用,用取消令牌表达取消。
// 不变量:取消经显式令牌而非全局静态计数器;会话不直接持有窗口句柄,产物经事件总线发布。

const UNIMPLEMENTED = '未实现,见目标架构设计第七节迁移里程碑';

class UtteranceSession {
  // request 为发言请求,返回取消令牌
  start(request) {
    throw new Error(UNIMPLEMENTED);
  }

  // 经令牌取消进行中的发言
  cancel(token) {
    throw new Error(UNIMPLEMENTED);
  }
}

module.exports = { UtteranceSession };
