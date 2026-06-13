// 运行方式:node --test tests/platform/speech-backend.test.js
const { test } = require('node:test');
const assert = require('node:assert');
const { SpeechBackend } = require('../../src/platform/speech/speech-backend');

//// 抽象接口的两个方法在未重写时抛错,逼迫子类实现 [@busybee 2026-06-13] ////
test('synthesize 未实现时抛错', () => {
  const backend = new SpeechBackend();
  assert.throws(() => backend.synthesize('text', {}), /synthesize/);
});

test('dispose 未实现时抛错', () => {
  const backend = new SpeechBackend();
  assert.throws(() => backend.dispose(), /dispose/);
});

//// 子类重写后方法可正常调用,契约可被实现 [@busybee 2026-06-13] ////
test('子类重写后契约可用', () => {
  class FakeBackend extends SpeechBackend {
    synthesize(text) { return Buffer.from(text); }
    dispose() { this.disposed = true; }
  }
  const backend = new FakeBackend();
  assert.ok(backend instanceof SpeechBackend);
  assert.deepStrictEqual(backend.synthesize('hi'), Buffer.from('hi'));
  backend.dispose();
  assert.strictEqual(backend.disposed, true);
});
