// audience: internal
// # capability-gateway
// 分级能力网关:截屏、外发、文件等重能力逐能力门控,替代扁平 electronAPI。
// 不变量:重能力每次调用都经本网关集中拦截、按作用域校验、逐次确认且可撤销。

const registry = require('./channel-registry');

const D = registry.CapabilityDomain;

//// 声明哪些能力域为重能力,需逐能力门控;其余域直接放行 [@busybee 2026-06-13] ////
const GATED_DOMAINS = new Set([D.screen, D.outbound, D.file]);

//// 注入的协作者:executor 执行能力、confirm 逐次确认、masterEnabled 全局总闸 [@busybee 2026-06-13] ////
let deps = {
  executor: null,
  confirm: () => true,
  masterEnabled: () => true
};

//// 记录已授权的「能力+作用域」对,授权后同对免再确认直至被撤销 [@busybee 2026-06-13] ////
const grants = new Set();

//// 把能力与作用域拼成授权记录的键 [@busybee 2026-06-13] ////
function grantKey(capabilityId, scope) {
  return `${capabilityId}::${scope}`;
}

//// 判断一个能力是否为受门控的重能力 [@busybee 2026-06-13] ////
function isGated(capabilityId) {
  return GATED_DOMAINS.has(registry.capabilityDomainOf(capabilityId));
}

//// 在入口装配协作者,替代抓全局;未给的项保留默认 [@busybee 2026-06-13] ////
function configure(injected) {
  deps = { ...deps, ...injected };
}

//// 查一个能力在某作用域下当前是否已获授权 [@busybee 2026-06-13] ////
function isAuthorized(capabilityId, scope) {
  if (!registry.isKnown(capabilityId)) return false;
  if (!isGated(capabilityId)) return true;
  if (!deps.masterEnabled()) return false;
  return grants.has(grantKey(capabilityId, scope));
}

//// 经网关调用一个能力:重能力先过总闸、再逐次确认授权,最后才委托执行 [@busybee 2026-06-13] ////
async function invoke(capabilityId, scope, payload) {
  if (!registry.isKnown(capabilityId)) {
    return { success: false, error: `未声明的能力:${capabilityId}` };
  }
  if (isGated(capabilityId)) {
    if (!deps.masterEnabled()) {
      return { success: false, error: 'capability master switch off' };
    }
    if (!grants.has(grantKey(capabilityId, scope))) {
      const approved = await deps.confirm(capabilityId, scope);
      if (!approved) {
        return { success: false, error: 'capability denied' };
      }
      grants.add(grantKey(capabilityId, scope));
    }
  }
  if (typeof deps.executor !== 'function') {
    return { success: false, error: 'no executor configured' };
  }
  return deps.executor(capabilityId, payload);
}

//// 撤销一个能力在某作用域下的授权,下次调用需重新确认 [@busybee 2026-06-13] ////
function revoke(capabilityId, scope) {
  grants.delete(grantKey(capabilityId, scope));
}

module.exports = { invoke, isAuthorized, revoke, configure };
