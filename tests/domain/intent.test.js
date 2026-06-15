// audience: internal
// # intent.test
// 验证 Intent 的数据契约:纯数据无方法;从声明逐字段拷贝并校验必填项,可追溯而非深反射。

const { test } = require('node:test');
const assert = require('node:assert');
const { Intent, TriggerWhen, ProductKind, intentFromDeclaration } = require('../../src/domain/intent/intent');

//// 新建意图是各字段为空的纯数据 [@x380kkm 2026-06-13] ////
test('a fresh Intent is empty pure data', () => {
  const intent = new Intent();
  assert.strictEqual(intent.id, null);
  assert.strictEqual(intent.trigger, null);
  assert.deepStrictEqual(intent.contextSourceRefs, []);
  assert.deepStrictEqual(intent.fewShotRefs, []);
  assert.strictEqual(intent.product, null);
  assert.strictEqual(intent.origin, null);
});

//// 从声明逐字段拷贝并带来源 [@x380kkm 2026-06-13] ////
test('intentFromDeclaration copies declared fields and tags origin', () => {
  const intent = intentFromDeclaration({
    id: 'observe-response',
    trigger: { when: TriggerWhen.VisualInput },
    contextSourceRefs: ['situationDigest', 'recentReplies'],
    fewShotRefs: ['structure/observe-response'],
    product: { kind: ProductKind.UseTemplate, templateId: 'reply-bubble' },
  }, 'builtin');

  assert.ok(intent instanceof Intent);
  assert.strictEqual(intent.id, 'observe-response');
  assert.deepStrictEqual(intent.trigger, { when: 'visual-input' });
  assert.deepStrictEqual(intent.contextSourceRefs, ['situationDigest', 'recentReplies']);
  assert.deepStrictEqual(intent.fewShotRefs, ['structure/observe-response']);
  assert.deepStrictEqual(intent.product, { kind: 'use-template', templateId: 'reply-bubble' });
  assert.strictEqual(intent.origin, 'builtin');
});

//// 拷贝引用数组,改原声明不影响已建意图 [@x380kkm 2026-06-13] ////
test('intentFromDeclaration copies ref arrays so mutating the source is isolated', () => {
  const refs = ['idleInfo'];
  const decl = { id: 'idle-chat', trigger: { when: TriggerWhen.Idle }, contextSourceRefs: refs };
  const intent = intentFromDeclaration(decl, 'builtin');

  refs.push('focusInfo');

  assert.deepStrictEqual(intent.contextSourceRefs, ['idleInfo']);
});

//// 缺 id 报清晰错误 [@x380kkm 2026-06-13] ////
test('intentFromDeclaration rejects a declaration without a string id', () => {
  assert.throws(
    () => intentFromDeclaration({ trigger: { when: TriggerWhen.Idle } }, 'builtin'),
    /缺少字符串 id/,
  );
});

//// 触发条件取值非法报错 [@x380kkm 2026-06-13] ////
test('intentFromDeclaration rejects an unknown trigger.when', () => {
  assert.throws(
    () => intentFromDeclaration({ id: 'x', trigger: { when: 'whenever' } }, 'builtin'),
    /trigger\.when/,
  );
});

//// mod 事件触发缺 event 名报错 [@x380kkm 2026-06-13] ////
test('intentFromDeclaration rejects a mod-event trigger missing the event name', () => {
  assert.throws(
    () => intentFromDeclaration({ id: 'win', trigger: { when: TriggerWhen.ModEvent } }, 'mod:game'),
    /event 名/,
  );
});

//// mod 事件触发保留 event 名 [@x380kkm 2026-06-13] ////
test('intentFromDeclaration keeps the event name for a mod-event trigger', () => {
  const intent = intentFromDeclaration({
    id: 'on-win',
    trigger: { when: TriggerWhen.ModEvent, event: 'game:win' },
  }, 'mod:game');

  assert.deepStrictEqual(intent.trigger, { when: 'mod-event', event: 'game:win' });
});
