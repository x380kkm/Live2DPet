// 验证 channel-registry 的通道契约:枚举、校验、按能力域分级。
const { test } = require('node:test');
const assert = require('node:assert');

const registry = require('../../src/platform/ipc/channel-registry');

test('channels 返回非空且无重复的通道名列表', () => {
  const all = registry.channels();
  assert.ok(Array.isArray(all));
  assert.ok(all.length > 0);
  const unique = new Set(all);
  assert.strictEqual(unique.size, all.length);
});

test('isKnown 对已声明通道为真,对未声明通道为假', () => {
  assert.strictEqual(registry.isKnown('open-external'), true);
  assert.strictEqual(registry.isKnown('get-screen-capture'), true);
  assert.strictEqual(registry.isKnown('not-a-channel'), false);
  assert.strictEqual(registry.isKnown(''), false);
  assert.strictEqual(registry.isKnown(undefined), false);
});

test('capabilityDomainOf 把重能力通道归到对应能力域', () => {
  assert.strictEqual(registry.capabilityDomainOf('get-screen-capture'), 'screen');
  assert.strictEqual(registry.capabilityDomainOf('get-open-windows'), 'screen');
  assert.strictEqual(registry.capabilityDomainOf('open-external'), 'outbound');
  assert.strictEqual(registry.capabilityDomainOf('web-search'), 'outbound');
  assert.strictEqual(registry.capabilityDomainOf('copy-model-to-userdata'), 'file');
  assert.strictEqual(registry.capabilityDomainOf('select-model-folder'), 'file');
});

test('capabilityDomainOf 把无害 UI 控制通道归到 ui 域', () => {
  assert.strictEqual(registry.capabilityDomainOf('set-window-size'), 'ui');
  assert.strictEqual(registry.capabilityDomainOf('show-pet-chat'), 'ui');
});

test('capabilityDomainOf 对未声明通道返回 null', () => {
  assert.strictEqual(registry.capabilityDomainOf('not-a-channel'), null);
});

test('每个通道都被映射到 CapabilityDomain 里声明过的域', () => {
  const domains = new Set(Object.values(registry.CapabilityDomain));
  for (const name of registry.channels()) {
    const domain = registry.capabilityDomainOf(name);
    assert.ok(domains.has(domain), `通道 ${name} 的域 ${domain} 未在 CapabilityDomain 声明`);
  }
});
