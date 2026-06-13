// 运行:node --test tests/domain/fewshot-scene.test.js
// 验证场景台词 few-shot:成品台词必留、按角色隔离、渲染成示例轮次、解析器与提示词指令配合。
const { test } = require('node:test');
const assert = require('node:assert');
const { FewShotBank } = require('../../src/domain/fewshot/fewshot-bank');
const { FewShotResolver } = require('../../src/domain/fewshot/fewshot-resolver');
const { PromptComposer } = require('../../src/domain/pet/prompt-composer');

function sample() {
  return {
    name: 'desktop', characterId: '雪', scenes: [
      { scene: '主人卡在报错上', lines: ['哼,连这种报错都要瞪半天。', '又卡住啦?要不要我看一眼。'] },
      { scene: '主人深夜不睡', lines: ['都几点了还不睡。'] }
    ]
  };
}

test('入库成品台词并渲染成场景与台词的示例轮次', () => {
  const bank = new FewShotBank();
  bank.registerSceneSet(sample());
  const turns = bank.composeSceneTurns(bank.resolveSceneSet('desktop', '雪'));
  // 三条台词各配一个场景用户轮与角色台词回应轮,共六轮
  assert.strictEqual(turns.length, 6);
  assert.deepStrictEqual(turns[0], { role: 'user', content: '场景:主人卡在报错上' });
  assert.deepStrictEqual(turns[1], { role: 'assistant', content: '哼,连这种报错都要瞪半天。' });
});

test('场景与每场景台词数可截断', () => {
  const bank = new FewShotBank();
  bank.registerSceneSet(sample());
  const turns = bank.composeSceneTurns(bank.resolveSceneSet('desktop', '雪'), { maxScenes: 1, maxLinesPerScene: 1 });
  assert.strictEqual(turns.length, 2);
});

test('缺成品台词的场景样例被拒绝', () => {
  const bank = new FewShotBank();
  assert.throws(() => bank.registerSceneSet({ name: 'x', characterId: '雪', scenes: [{ scene: '无台词', lines: [] }] }), /成品台词/);
});

test('场景台词按角色隔离,跨角色不可见', () => {
  const bank = new FewShotBank();
  bank.registerSceneSet(sample());
  assert.strictEqual(bank.resolveSceneSet('desktop', '别的角色'), null);
});

test('解析器按场景台词引用渲染轮次', () => {
  const bank = new FewShotBank();
  bank.registerSceneSet(sample());
  const resolver = new FewShotResolver(bank);
  const turns = resolver.resolve([{ sceneSet: 'desktop', options: { maxLinesPerScene: 1 } }], '雪');
  assert.strictEqual(turns.length, 4);
  assert.strictEqual(turns[1].content, '哼,连这种报错都要瞪半天。');
});

test('有样例时提示词指令要求模仿不照抄、不重复', () => {
  const bank = new FewShotBank();
  bank.registerSceneSet(sample());
  const composer = new PromptComposer({ fewShotResolver: new FewShotResolver(bank), persona: { description: '雪' } });
  const { messages } = composer.compose(
    { id: 'observe', fewShotRefs: [{ sceneSet: 'desktop' }] },
    { text: '当前:主人卡报错' },
    { characterId: '雪' }
  );
  const last = messages[messages.length - 1];
  assert.match(last.content, /模仿/);
  assert.match(last.content, /不要照抄/);
  // 中间夹着成品台词示例轮
  assert.ok(messages.some((m) => m.role === 'assistant' && m.content.includes('瞪半天')));
});

test('无样例时指令回到朴素一句,不提模仿', () => {
  const composer = new PromptComposer({ fewShotResolver: new FewShotResolver(new FewShotBank()), persona: {} });
  const { messages } = composer.compose({ id: 'idle', fewShotRefs: [] }, { text: '' }, { characterId: '雪' });
  const last = messages[messages.length - 1];
  assert.doesNotMatch(last.content, /模仿/);
});
