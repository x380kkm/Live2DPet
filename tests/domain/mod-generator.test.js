// audience: internal
// # mod-generator.test
// 验证 ModGenerator:据生成意图请模型造产物、提示词只示范结构且禁写文风、
// 产物含人格或成品措辞时拒绝、合法产物物化成 mod。

const { test } = require('node:test');
const assert = require('node:assert');
const { ModGenerator, STRUCTURE_FEWSHOT } = require('../../src/domain/mod/mod-generator');

//// 用预设回复构造一个最简注入 LLM,顺带记录请求 [@x380kkm 2026-06-13] ////
function fakeLlm(text, captured) {
  return {
    async complete(request) {
      if (captured) captured.request = request;
      return { text };
    }
  };
}

//// 合法产物被物化成 mod [@x380kkm 2026-06-13] ////
test('generate materializes a valid behavior-only product into a mod', async () => {
  const produced = { id: 'pat', emits: ['click'], hostApi: ['playAction'], intents: [{ id: 'react', trigger: 'click' }] };
  const generator = new ModGenerator({ llm: fakeLlm(JSON.stringify(produced)) });

  const mod = await generator.generate({ kind: 'tap-toy' });

  assert.strictEqual(mod.id, 'pat');
  assert.deepStrictEqual(mod.emits, ['click']);
  assert.deepStrictEqual(mod.hostApi, ['playAction']);
});

//// 请求只示范结构且明令禁写人格与成品措辞 [@x380kkm 2026-06-13] ////
test('request demonstrates only structure and forbids persona or finished wording', async () => {
  const captured = {};
  const produced = { id: 'pat', emits: [], intents: [] };
  const generator = new ModGenerator({ llm: fakeLlm(JSON.stringify(produced), captured) });

  await generator.generate({ kind: 'tap-toy' });

  const system = captured.request.messages[0].content;
  const user = captured.request.messages[1].content;
  assert.match(system, /禁止/);
  // few-shot 样例值全为占位,不含成品句子。
  assert.ok(user.includes(JSON.stringify(STRUCTURE_FEWSHOT)));
});

//// 产物含人格键时拒绝写入 [@x380kkm 2026-06-13] ////
test('a product carrying a persona field is rejected', async () => {
  const produced = { id: 'pat', persona: '害羞的猫', emits: [] };
  const generator = new ModGenerator({ llm: fakeLlm(JSON.stringify(produced)) });
  await assert.rejects(() => generator.generate({ kind: 'tap-toy' }), /人格或成品措辞/);
});

//// 嵌套深处的成品措辞键也被拒绝 [@x380kkm 2026-06-13] ////
test('finished wording nested deep in the product is also rejected', async () => {
  const produced = { id: 'pat', frontendSpec: { js: 'x', phrases: ['你好呀'] } };
  const generator = new ModGenerator({ llm: fakeLlm(JSON.stringify(produced)) });
  await assert.rejects(() => generator.generate({ kind: 'tap-toy' }), /人格或成品措辞/);
});

//// 注入的解析器被用来解出产物 [@x380kkm 2026-06-13] ////
test('the injected parser is used to parse the model text', async () => {
  let parsedFrom = null;
  const generator = new ModGenerator({
    llm: fakeLlm('RAW-TEXT'),
    parseSpec(text) { parsedFrom = text; return { id: 'pat' }; }
  });
  const mod = await generator.generate({ kind: 'tap-toy' });
  assert.strictEqual(parsedFrom, 'RAW-TEXT');
  assert.strictEqual(mod.id, 'pat');
});
