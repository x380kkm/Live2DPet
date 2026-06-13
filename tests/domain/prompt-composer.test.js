// audience: internal
// # prompt-composer.test
// 验证 PromptComposer 的行为契约:人格分段与上下文折成系统提示、按角色解析 few-shot、按预算裁剪样例、意图收尾。

const { test } = require('node:test');
const assert = require('node:assert');
const { PromptComposer } = require('../../src/domain/pet/prompt-composer');

//// 造一个记录调用、按角色回固定轮次的 few-shot 解析器替身 [@busybee 2026-06-13] ////
function fakeResolver(turnsByCharacter) {
  const calls = [];
  return {
    calls,
    resolve(refs, characterId) {
      calls.push({ refs, characterId });
      return turnsByCharacter[characterId] || [];
    }
  };
}

const PERSONA = {
  responseMode: 'RESPOND FAST',
  description: 'You are Yuki.',
  personality: 'Warm and brief.',
  scenario: 'Keep it short.',
  rules: 'NO emoji.',
  importantReminder: 'REMEMBER THE RULES.',
  language: 'English',
  useLanguageTemplate: 'Reply in {0}.'
};

//// 系统提示按人格段序拼装,缺字段不出现 [@busybee 2026-06-13] ////
test('system content assembles persona parts in order', () => {
  const composer = new PromptComposer({ persona: PERSONA, fewShotResolver: fakeResolver({}) });
  const { messages } = composer.compose({ id: 'idle-chat', fewShotRefs: [] }, { text: '' }, {});

  const system = messages[0].content;
  assert.strictEqual(messages[0].role, 'system');
  const expected = [
    'RESPOND FAST', 'You are Yuki.', 'Warm and brief.', 'Keep it short.',
    '---', 'NO emoji.', 'REMEMBER THE RULES.',
    'Reply in English.'
  ].join('\n\n');
  assert.strictEqual(system, expected);
});

//// 缺人格字段时该段略过,不留空行 [@busybee 2026-06-13] ////
test('absent persona fields are skipped', () => {
  const composer = new PromptComposer({ persona: { description: 'You are Yuki.' }, fewShotResolver: fakeResolver({}) });
  const { messages } = composer.compose({ id: 'x', fewShotRefs: [] }, { text: '' }, {});
  assert.strictEqual(messages[0].content, 'You are Yuki.');
});

//// 已组装上下文以分隔线接在规则之后 [@busybee 2026-06-13] ////
test('assembled context is appended after rules with a separator', () => {
  const composer = new PromptComposer({
    persona: { description: 'You are Yuki.', rules: 'NO emoji.' },
    fewShotResolver: fakeResolver({})
  });
  const { messages } = composer.compose({ id: 'x', fewShotRefs: [] }, { text: '在写代码' }, {});
  const expected = ['You are Yuki.', '---', 'NO emoji.', '---', '在写代码'].join('\n\n');
  assert.strictEqual(messages[0].content, expected);
});

//// few-shot 轮次按角色解析后插在系统提示与意图指令之间 [@busybee 2026-06-13] ////
test('few-shot turns sit between system prompt and intent instruction', () => {
  const resolver = fakeResolver({
    yuki: [
      { role: 'user', content: 'EX-U' },
      { role: 'assistant', content: 'EX-A' }
    ]
  });
  const composer = new PromptComposer({ persona: { description: 'P' }, fewShotResolver: resolver });
  const { messages } = composer.compose(
    { id: 'observe-response', fewShotRefs: ['structure/observe-response'] },
    { text: '' },
    { characterId: 'yuki' }
  );

  assert.strictEqual(messages.length, 4);
  assert.strictEqual(messages[0].role, 'system');
  assert.deepStrictEqual(messages[1], { role: 'user', content: 'EX-U' });
  assert.deepStrictEqual(messages[2], { role: 'assistant', content: 'EX-A' });
  assert.strictEqual(messages[3].role, 'user');
  // 解析器拿到意图的 few-shot 引用与作用域里的角色 id。
  assert.deepStrictEqual(resolver.calls[0], { refs: ['structure/observe-response'], characterId: 'yuki' });
});

//// 无角色 id 时按空角色解析,跨角色不借文风 [@busybee 2026-06-13] ////
test('missing character id resolves with empty character', () => {
  const resolver = fakeResolver({});
  const composer = new PromptComposer({ persona: {}, fewShotResolver: resolver });
  composer.compose({ id: 'x', fewShotRefs: ['s'] }, { text: '' }, {});
  assert.strictEqual(resolver.calls[0].characterId, '');
});

//// few-shot 预算从前往后累加,超预算丢其后全部轮次 [@busybee 2026-06-13] ////
test('few-shot budget keeps a prefix and drops the rest', () => {
  const resolver = fakeResolver({
    yuki: [
      { role: 'user', content: 'aaaa' },      // 估算 1 token
      { role: 'assistant', content: 'bbbb' },  // 累计 2 token
      { role: 'user', content: 'cccc' }        // 超预算被丢
    ]
  });
  const composer = new PromptComposer(
    { persona: {}, fewShotResolver: resolver },
    { fewShotBudget: 2 }
  );
  const { messages } = composer.compose({ id: 'x', fewShotRefs: ['s'] }, { text: '' }, { characterId: 'yuki' });

  // 系统提示 + 两条样例 + 意图指令。
  assert.strictEqual(messages.length, 4);
  assert.strictEqual(messages[1].content, 'aaaa');
  assert.strictEqual(messages[2].content, 'bbbb');
});

//// 预算未给定时全数保留样例轮次 [@busybee 2026-06-13] ////
test('without a budget all few-shot turns are kept', () => {
  const resolver = fakeResolver({
    yuki: [{ role: 'user', content: 'x'.repeat(40) }, { role: 'assistant', content: 'y'.repeat(40) }]
  });
  const composer = new PromptComposer({ persona: {}, fewShotResolver: resolver });
  const { messages } = composer.compose({ id: 'x', fewShotRefs: ['s'] }, { text: '' }, { characterId: 'yuki' });
  assert.strictEqual(messages.length, 4);
});

//// 收尾指令带上态势摘要与意图 id [@busybee 2026-06-13] ////
test('intent instruction carries situation digest and intent id', () => {
  const composer = new PromptComposer({ persona: {}, fewShotResolver: fakeResolver({}) });
  const { messages } = composer.compose(
    { id: 'idle-chat', fewShotRefs: [] },
    { text: '' },
    { situationDigest: '在看文档' }
  );
  const instruction = messages[messages.length - 1];
  assert.strictEqual(instruction.role, 'user');
  assert.ok(instruction.content.includes('在看文档'));
  assert.ok(instruction.content.includes('idle-chat'));
});

//// 无解析器时不产出样例轮次也不报错 [@busybee 2026-06-13] ////
test('no resolver yields no few-shot turns', () => {
  const composer = new PromptComposer({ persona: { description: 'P' } });
  const { messages } = composer.compose({ id: 'x', fewShotRefs: ['s'] }, { text: '' }, { characterId: 'yuki' });
  assert.strictEqual(messages.length, 2);
});

//// 可注入自定义 token 估算函数 [@busybee 2026-06-13] ////
test('a custom token estimator drives budget trimming', () => {
  const resolver = fakeResolver({
    yuki: [{ role: 'user', content: 'a' }, { role: 'assistant', content: 'b' }]
  });
  // 每条轮次恒计 2 token,预算 2 只容得下一条。
  const composer = new PromptComposer(
    { persona: {}, fewShotResolver: resolver, estimateTokens: () => 2 },
    { fewShotBudget: 2 }
  );
  const { messages } = composer.compose({ id: 'x', fewShotRefs: ['s'] }, { text: '' }, { characterId: 'yuki' });
  assert.strictEqual(messages.length, 3);
  assert.strictEqual(messages[1].content, 'a');
});
