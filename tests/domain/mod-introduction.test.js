// audience: internal
// # mod-introduction.test
// 验证 mod 引入:中性描述只取行为面、不含措辞,引入源把作用域里的描述折成上下文、无则跳过。
// 运行: node --test tests/domain/mod-introduction.test.js

const { test } = require('node:test');
const assert = require('node:assert');
const { describeModNeutrally } = require('../../src/domain/pet/mod-introduction');
const { ModIntroductionSource } = require('../../src/domain/pet/sources/mod-introduction-source');

//// 中性描述列出 mod 会响应的交互,并要求按人格现场介绍 [@busybee 2026-06-14] ////
test('describeModNeutrally 列出交互行为并要求现场介绍', () => {
  const text = describeModNeutrally({ id: 'm', emits: ['click', 'win'] });
  assert.match(text, /click、win/);
  assert.match(text, /人格/);
  // 不含任何成品措辞或人格文本(mod 本无措辞,这里也不造)
  assert.doesNotMatch(text, /persona|台词模板/);
});

//// 无 emits 时给中性占位,不报错 [@busybee 2026-06-14] ////
test('describeModNeutrally 无交互事件时给中性占位', () => {
  assert.match(describeModNeutrally({ id: 'm', emits: [] }), /新的小互动/);
  assert.strictEqual(describeModNeutrally(null), '');
});

//// 引入源把作用域里的描述折成上下文,无描述返回 null [@busybee 2026-06-14] ////
test('ModIntroductionSource 渲染作用域里的引入描述', () => {
  const source = new ModIntroductionSource();
  assert.strictEqual(source.id, 'modIntroduction');
  assert.strictEqual(source.render({ modIntroduction: '介绍它' }), '介绍它');
  assert.strictEqual(source.render({}), null);
  assert.strictEqual(source.render(null), null);
});
