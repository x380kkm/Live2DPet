// audience: internal
// # fewshot-bank.test
// 验证 FewShotBank 的行为契约:入库期校验、结构全局共享、语气按角色隔离、插槽合成。

const { test } = require('node:test');
const assert = require('node:assert');
const { FewShotBank } = require('../../src/domain/fewshot/fewshot-bank');

//// 造一条合法结构样例:只含骨架与槽位 [@x380kkm 2026-06-13] ////
function structureSample(overrides = {}) {
  return Object.assign({
    name: 'greet',
    slots: ['opener', 'subject'],
    turns: [
      { role: 'user', template: '{{subject}}' },
      { role: 'assistant', template: '{{opener}} {{subject}}' }
    ]
  }, overrides);
}

//// 造一条合法语气样例:只供槽位填充 [@x380kkm 2026-06-13] ////
function toneSample(overrides = {}) {
  return Object.assign({
    name: 'greet',
    characterId: 'yuki',
    fillers: { opener: 'hey', subject: 'desk' }
  }, overrides);
}

test('入库合法结构样例后能按名解析', () => {
  const bank = new FewShotBank();
  bank.registerStructure(structureSample());
  const s = bank.resolveStructure('greet');
  assert.strictEqual(s.name, 'greet');
});

test('未命中结构返回 null', () => {
  const bank = new FewShotBank();
  assert.strictEqual(bank.resolveStructure('missing'), null);
});

test('结构样例字面含成品措辞在入库期被拒', () => {
  const bank = new FewShotBank();
  const bad = structureSample({
    turns: [{ role: 'assistant', template: '你好呀!{{subject}}' }]
  });
  assert.throws(() => bank.registerStructure(bad), /成品措辞/);
});

test('结构样例引用未声明槽位在入库期被拒', () => {
  const bank = new FewShotBank();
  const bad = structureSample({
    slots: ['opener'],
    turns: [{ role: 'assistant', template: '{{opener}} {{unknown}}' }]
  });
  assert.throws(() => bank.registerStructure(bad), /未声明的槽位/);
});

test('缺少 slots 的结构样例在入库期被拒', () => {
  const bank = new FewShotBank();
  assert.throws(() => bank.registerStructure({ name: 'x', turns: [] }), /slots/);
});

test('语气样例按角色分桶,本角色可解析', () => {
  const bank = new FewShotBank();
  bank.registerTone(toneSample());
  const t = bank.resolveTone('greet', 'yuki');
  assert.strictEqual(t.fillers.opener, 'hey');
});

test('语气跨角色不可见', () => {
  const bank = new FewShotBank();
  bank.registerTone(toneSample({ characterId: 'yuki' }));
  assert.strictEqual(bank.resolveTone('greet', 'rin'), null);
});

test('未命中角色桶的语气返回 null', () => {
  const bank = new FewShotBank();
  assert.strictEqual(bank.resolveTone('greet', 'nobody'), null);
});

test('携带 turns 的语气样例在入库期被拒', () => {
  const bank = new FewShotBank();
  const bad = toneSample({ turns: [{ role: 'user', template: 'x' }] });
  assert.throws(() => bank.registerTone(bad), /turns/);
});

test('缺少 characterId 的语气样例在入库期被拒', () => {
  const bank = new FewShotBank();
  const bad = toneSample();
  delete bad.characterId;
  assert.throws(() => bank.registerTone(bad), /characterId/);
});

test('compose 用语气填充把结构骨架填满', () => {
  const bank = new FewShotBank();
  const turns = bank.compose(structureSample(), toneSample(), {});
  assert.deepStrictEqual(turns, [
    { role: 'user', content: 'desk' },
    { role: 'assistant', content: 'hey desk' }
  ]);
});

test('compose 中调用方 slots 盖过语气 fillers', () => {
  const bank = new FewShotBank();
  const turns = bank.compose(structureSample(), toneSample(), { subject: 'taskbar' });
  assert.strictEqual(turns[0].content, 'taskbar');
  assert.strictEqual(turns[1].content, 'hey taskbar');
});

test('compose 在无语气时留空骨架,不外漏占位文本', () => {
  const bank = new FewShotBank();
  const turns = bank.compose(structureSample(), null, {});
  assert.strictEqual(turns[0].content, '');
  assert.strictEqual(turns[1].content, ' ');
  assert.ok(!turns[1].content.includes('{{'));
});

test('compose 对空结构返回空数组', () => {
  const bank = new FewShotBank();
  assert.deepStrictEqual(bank.compose(null, toneSample(), {}), []);
});
