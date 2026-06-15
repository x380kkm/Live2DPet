// audience: internal
// # context-source.test
// 验证上下文源与组装器的行为契约:按优先级排序、累加到预算截断、跳过渲染为空的源。

const { test } = require('node:test');
const assert = require('node:assert');
const {
  ContextSource,
  NamedContextSource,
  ContextAssembler,
  estimateTextTokens
} = require('../../src/domain/pet/context-source');

//// 命名源把渲染函数暴露为 id、优先级与渲染 [@x380kkm 2026-06-13] ////
test('named source exposes id, priority and render', () => {
  const source = new NamedContextSource({
    id: 'idle',
    priority: 10,
    render: (scope) => `闲置 ${scope.idleSec} 秒`
  });

  assert.strictEqual(source.id, 'idle');
  assert.strictEqual(source.priority, 10);
  assert.strictEqual(source.render({ idleSec: 60 }), '闲置 60 秒');
  assert.ok(source instanceof ContextSource);
});

//// 缺省 token 估算按字符数粗估 [@x380kkm 2026-06-13] ////
test('default token estimate follows character count', () => {
  assert.strictEqual(estimateTextTokens(''), 0);
  assert.strictEqual(estimateTextTokens(null), 0);
  // 8 个字符约两个 token。
  assert.strictEqual(estimateTextTokens('abcdefgh'), 2);
});

//// 注入的 estimateTokens 覆盖缺省估算 [@x380kkm 2026-06-13] ////
test('explicit estimateTokens overrides default', () => {
  const source = new NamedContextSource({
    id: 'focus',
    priority: 5,
    render: () => '很长的一段文本',
    estimateTokens: () => 99
  });

  assert.strictEqual(source.estimateTokens(), 99);
});

//// 组装器按优先级从高到低排序拼接 [@x380kkm 2026-06-13] ////
test('assembler orders fragments by priority descending', () => {
  const low = new NamedContextSource({ id: 'low', priority: 1, render: () => 'L' });
  const high = new NamedContextSource({ id: 'high', priority: 9, render: () => 'H' });
  const mid = new NamedContextSource({ id: 'mid', priority: 5, render: () => 'M' });
  const assembler = new ContextAssembler();

  const result = assembler.assemble([low, high, mid], {}, undefined);

  assert.deepStrictEqual(result.fragments.map((f) => f.id), ['high', 'mid', 'low']);
  assert.strictEqual(result.text, 'H\nM\nL');
});

//// 优先级相等时保持原始相对顺序 [@x380kkm 2026-06-13] ////
test('assembler keeps original order on equal priority', () => {
  const first = new NamedContextSource({ id: 'first', priority: 5, render: () => 'F' });
  const second = new NamedContextSource({ id: 'second', priority: 5, render: () => 'S' });
  const assembler = new ContextAssembler();

  const result = assembler.assemble([first, second], {}, undefined);

  assert.deepStrictEqual(result.fragments.map((f) => f.id), ['first', 'second']);
});

//// 渲染返回 null 或空串的源被跳过 [@x380kkm 2026-06-13] ////
test('assembler skips sources rendering null or empty', () => {
  const present = new NamedContextSource({ id: 'present', priority: 5, render: () => '在' });
  const nullish = new NamedContextSource({ id: 'nullish', priority: 9, render: () => null });
  const empty = new NamedContextSource({ id: 'empty', priority: 8, render: () => '' });
  const assembler = new ContextAssembler();

  const result = assembler.assemble([present, nullish, empty], {}, undefined);

  assert.deepStrictEqual(result.fragments.map((f) => f.id), ['present']);
  assert.strictEqual(result.text, '在');
});

//// 累计 token 超出预算的源被截断 [@x380kkm 2026-06-13] ////
test('assembler truncates sources exceeding the budget', () => {
  const big = new NamedContextSource({ id: 'big', priority: 9, render: () => 'X', estimateTokens: () => 8 });
  const small = new NamedContextSource({ id: 'small', priority: 5, render: () => 'Y', estimateTokens: () => 5 });
  const tiny = new NamedContextSource({ id: 'tiny', priority: 1, render: () => 'Z', estimateTokens: () => 1 });
  const assembler = new ContextAssembler();

  // 预算 10:big 占 8,small 加上去会到 13 超预算被跳过,tiny 加上去到 9 仍在预算内。
  const result = assembler.assemble([big, small, tiny], {}, 10);

  assert.deepStrictEqual(result.fragments.map((f) => f.id), ['big', 'tiny']);
  assert.strictEqual(result.tokens, 9);
});

//// 缺省源以渲染结果作 token 估算的依据 [@x380kkm 2026-06-13] ////
test('source without explicit estimate uses rendered text length', () => {
  const source = new NamedContextSource({ id: 'auto', priority: 1, render: () => 'abcdefgh' });
  assert.strictEqual(source.estimateTokens(), 2);
});
