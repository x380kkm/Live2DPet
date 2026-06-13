// 验证 capability-gateway 的分级门控契约:重能力逐次确认、可撤销、总闸生效。
const { test } = require('node:test');
const assert = require('node:assert');

const gateway = require('../../src/platform/ipc/capability-gateway');

// 装配一组可观察的协作者:记录确认次数与执行参数 [@busybee 2026-06-13]
function makeDeps({ confirm = async () => true, masterEnabled = () => true } = {}) {
  const calls = { confirm: 0, executed: [] };
  return {
    deps: {
      executor: async (capabilityId, payload) => { calls.executed.push({ capabilityId, payload }); return { success: true, ran: capabilityId }; },
      confirm: async (capabilityId, scope) => { calls.confirm++; return confirm(capabilityId, scope); },
      masterEnabled
    },
    calls
  };
}

test('未声明的能力被拒绝执行', async () => {
  const { deps } = makeDeps();
  gateway.configure(deps);
  const result = await gateway.invoke('not-a-capability', 'g', null);
  assert.strictEqual(result.success, false);
  assert.match(result.error, /未声明的能力/);
});

test('无害 UI 能力无需确认即视为已授权并直接执行', async () => {
  const { deps, calls } = makeDeps();
  gateway.configure(deps);
  assert.strictEqual(gateway.isAuthorized('set-window-size', 'g'), true);
  const result = await gateway.invoke('set-window-size', 'g', { w: 200 });
  assert.strictEqual(result.success, true);
  assert.strictEqual(calls.confirm, 0);
  assert.strictEqual(calls.executed.length, 1);
});

test('重能力首次调用触发逐次确认,确认后才执行', async () => {
  const { deps, calls } = makeDeps();
  gateway.configure(deps);
  const scope = 'scope-screen-first';
  assert.strictEqual(gateway.isAuthorized('get-screen-capture', scope), false);
  const result = await gateway.invoke('get-screen-capture', scope, null);
  assert.strictEqual(result.success, true);
  assert.strictEqual(calls.confirm, 1);
  assert.strictEqual(gateway.isAuthorized('get-screen-capture', scope), true);
  gateway.revoke('get-screen-capture', scope);
});

test('授权后同一能力与作用域免再确认', async () => {
  const { deps, calls } = makeDeps();
  gateway.configure(deps);
  const scope = 'scope-screen-cached';
  await gateway.invoke('get-screen-capture', scope, null);
  await gateway.invoke('get-screen-capture', scope, null);
  assert.strictEqual(calls.confirm, 1);
  assert.strictEqual(calls.executed.length, 2);
  gateway.revoke('get-screen-capture', scope);
});

test('revoke 后该能力需重新确认', async () => {
  const { deps, calls } = makeDeps();
  gateway.configure(deps);
  const scope = 'scope-screen-revoke';
  await gateway.invoke('get-screen-capture', scope, null);
  gateway.revoke('get-screen-capture', scope);
  assert.strictEqual(gateway.isAuthorized('get-screen-capture', scope), false);
  await gateway.invoke('get-screen-capture', scope, null);
  assert.strictEqual(calls.confirm, 2);
  gateway.revoke('get-screen-capture', scope);
});

test('用户拒绝确认时不执行能力', async () => {
  const { deps, calls } = makeDeps({ confirm: async () => false });
  gateway.configure(deps);
  const result = await gateway.invoke('open-external', 'scope-denied', null);
  assert.strictEqual(result.success, false);
  assert.match(result.error, /denied/);
  assert.strictEqual(calls.executed.length, 0);
});

test('总闸关闭时重能力被拒绝且不视为已授权', async () => {
  const { deps, calls } = makeDeps({ masterEnabled: () => false });
  gateway.configure(deps);
  assert.strictEqual(gateway.isAuthorized('web-search', 'scope-master'), false);
  const result = await gateway.invoke('web-search', 'scope-master', null);
  assert.strictEqual(result.success, false);
  assert.match(result.error, /master switch off/);
  assert.strictEqual(calls.confirm, 0);
  assert.strictEqual(calls.executed.length, 0);
});

test('作用域隔离:一个作用域的授权不波及另一作用域', async () => {
  const { deps } = makeDeps();
  gateway.configure(deps);
  await gateway.invoke('open-external', 'scope-a', null);
  assert.strictEqual(gateway.isAuthorized('open-external', 'scope-a'), true);
  assert.strictEqual(gateway.isAuthorized('open-external', 'scope-b'), false);
  gateway.revoke('open-external', 'scope-a');
});
