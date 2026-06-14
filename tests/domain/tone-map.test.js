// audience: internal
// # tone-map.test
// 验证情绪到语气字段的映射:已知情绪给出语调与停顿字段、大小写不敏感,未知或空情绪返回 null。

const { test } = require('node:test');
const assert = require('node:assert');
const { toneFor } = require('../../src/domain/tts/tone-map');

//// 已知情绪给出语气字段,愉快抬高语调、低落压低 [@busybee 2026-06-14] ////
test('已知情绪给出语气字段,愉快抬高语调、低落压低', () => {
  const happy = toneFor('happy');
  assert.ok(happy && typeof happy.intonationScale === 'number');
  assert.ok(happy.intonationScale > 1, '愉快应抬高语调');
  const sad = toneFor('sad');
  assert.ok(sad.intonationScale < 1, '低落应压低语调');
});

test('情绪名大小写不敏感', () => {
  assert.deepStrictEqual(toneFor('HAPPY'), toneFor('happy'));
});

test('未知或空情绪返回 null', () => {
  assert.strictEqual(toneFor('no-such-emotion'), null);
  assert.strictEqual(toneFor(''), null);
  assert.strictEqual(toneFor(null), null);
});
