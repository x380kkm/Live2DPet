// audience: internal
// # capability-gateway
// 分级能力网关:截屏、外发、文件等重能力逐能力门控,替代扁平 electronAPI。
// 不变量:重能力每次调用都经本网关集中拦截、按作用域校验、逐次确认且可撤销。

function invoke(capabilityId, scope, payload) {
  throw new Error('未实现,见目标架构设计第七节迁移里程碑');
}

function isAuthorized(capabilityId, scope) {
  throw new Error('未实现,见目标架构设计第七节迁移里程碑');
}

function revoke(capabilityId, scope) {
  throw new Error('未实现,见目标架构设计第七节迁移里程碑');
}

module.exports = { invoke, isAuthorized, revoke };
