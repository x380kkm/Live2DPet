// audience: internal
// # fewshot-resolver.test
// 验证 FewShotResolver 的行为契约:经构造注入的 bank 解析引用、按角色注入语气、守住文风隔离。

const { test } = require('node:test');
const assert = require('node:assert');
const { FewShotResolver } = require('../../src/domain/fewshot/fewshot-resolver');

//// 造一个记录调用的 mock bank,语气按角色分桶 [@busybee 2026-06-13] ////
// 用 mock 注入隔离 platform 与样例库,只断言解析器的编排行为。
function mockBank({ structures = {}, tones = {} } = {}) {
  const calls = { compose: [], resolveTone: [] };
  return {
    calls,
    resolveStructure(ref) {
      return structures[ref] || null;
    },
    resolveTone(ref, characterId) {
      calls.resolveTone.push({ ref, characterId });
      const bucket = tones[characterId] || {};
      return bucket[ref] || null;
    },
    //// 合成时把结构、语气、调用方槽位原样回填成可读轮次 [@busybee 2026-06-13] ////
    compose(structure, tone, slots) {
      calls.compose.push({ structure, tone, slots });
      return structure.turns.map((turn) => ({
        role: turn.role,
        content: `${tone ? tone.tag : 'none'}:${(slots && slots.subject) || turn.template}`
      }));
    }
  };
}

const greetStructure = { name: 'greet', turns: [{ role: 'assistant', template: 'BARE' }] };

test('解析展平多条引用的样例轮次', () => {
  const bank = mockBank({
    structures: { greet: greetStructure, idle: { name: 'idle', turns: [{ role: 'assistant', template: 'I' }] } },
    tones: { yuki: { greet: { tag: 'warm' }, idle: { tag: 'warm' } } }
  });
  const resolver = new FewShotResolver(bank);
  const turns = resolver.resolve([{ structure: 'greet' }, { structure: 'idle' }], 'yuki');
  assert.strictEqual(turns.length, 2);
  assert.strictEqual(turns[0].content, 'warm:BARE');
});

test('字符串引用被当作结构名解析', () => {
  const bank = mockBank({ structures: { greet: greetStructure }, tones: { yuki: { greet: { tag: 'warm' } } } });
  const resolver = new FewShotResolver(bank);
  const turns = resolver.resolve(['greet'], 'yuki');
  assert.strictEqual(turns.length, 1);
  assert.strictEqual(turns[0].content, 'warm:BARE');
});

test('语气名缺省回退到与结构同名', () => {
  const bank = mockBank({ structures: { greet: greetStructure }, tones: { yuki: { greet: { tag: 'warm' } } } });
  const resolver = new FewShotResolver(bank);
  resolver.resolve([{ structure: 'greet' }], 'yuki');
  assert.deepStrictEqual(bank.calls.resolveTone[0], { ref: 'greet', characterId: 'yuki' });
});

test('显式 tone 名覆盖缺省回退', () => {
  const bank = mockBank({ structures: { greet: greetStructure }, tones: { yuki: { soft: { tag: 'soft' } } } });
  const resolver = new FewShotResolver(bank);
  resolver.resolve([{ structure: 'greet', tone: 'soft' }], 'yuki');
  assert.deepStrictEqual(bank.calls.resolveTone[0], { ref: 'soft', characterId: 'yuki' });
});

test('调用方 slots 透传给 compose', () => {
  const bank = mockBank({ structures: { greet: greetStructure }, tones: { yuki: { greet: { tag: 'warm' } } } });
  const resolver = new FewShotResolver(bank);
  const turns = resolver.resolve([{ structure: 'greet', slots: { subject: 'taskbar' } }], 'yuki');
  assert.strictEqual(turns[0].content, 'warm:taskbar');
  assert.deepStrictEqual(bank.calls.compose[0].slots, { subject: 'taskbar' });
});

test('文风隔离:角色缺该语气样例时只留空骨架,不借用别角色文风', () => {
  const bank = mockBank({
    structures: { greet: greetStructure },
    tones: { yuki: { greet: { tag: 'warm' } } }
  });
  const resolver = new FewShotResolver(bank);
  // rin 没有 greet 语气,resolveTone 返回 null,compose 收到 null。
  const turns = resolver.resolve([{ structure: 'greet' }], 'rin');
  assert.strictEqual(turns[0].content, 'none:BARE');
});

test('结构缺失的引用被跳过', () => {
  const bank = mockBank({ structures: {}, tones: {} });
  const resolver = new FewShotResolver(bank);
  assert.deepStrictEqual(resolver.resolve([{ structure: 'missing' }], 'yuki'), []);
});

test('空引用列表返回空数组', () => {
  const bank = mockBank();
  const resolver = new FewShotResolver(bank);
  assert.deepStrictEqual(resolver.resolve(undefined, 'yuki'), []);
});

test('无 structure 字段的引用被跳过', () => {
  const bank = mockBank({ structures: { greet: greetStructure } });
  const resolver = new FewShotResolver(bank);
  assert.deepStrictEqual(resolver.resolve([{ tone: 'soft' }], 'yuki'), []);
});
