// audience: internal
// # sandbox-bridge
// 收窄消息白名单:前端经它访问极少数 api,拿不到原始能力网关。
// 不变量:只放行白名单内的 api 调用,白名单外的消息一律拒绝;前端不持有任何原始能力句柄。

class SandboxBridge {
  // 校验并分发一条来自沙箱的消息,白名单外拒绝。
  dispatch(msg) {
    throw new Error('未实现,见目标架构设计第七节迁移里程碑');
  }

  // 判断某个 api 名是否在白名单内。
  isAllowed(apiName) {
    throw new Error('未实现,见目标架构设计第七节迁移里程碑');
  }
}

module.exports = { SandboxBridge };
