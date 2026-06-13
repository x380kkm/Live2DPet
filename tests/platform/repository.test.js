// 运行: node --test tests/platform/repository.test.js
// 断言抽象基类的契约:三个方法均要求子类覆写,直接调用基类应抛错。

const { test } = require('node:test');
const assert = require('node:assert');
const { Repository } = require('../../src/platform/storage/repository');

test('基类 get 未覆写时抛错', () => {
  const repo = new Repository();
  assert.throws(() => repo.get('k'), /子类必须覆写/);
});

test('基类 put 未覆写时抛错', () => {
  const repo = new Repository();
  assert.throws(() => repo.put('k', 1), /子类必须覆写/);
});

test('基类 queryByTime 未覆写时抛错', () => {
  const repo = new Repository();
  assert.throws(() => repo.queryByTime({}), /子类必须覆写/);
});

test('子类覆写后调用走子类实现', () => {
  class Stub extends Repository {
    get(key) { return `got:${key}`; }
  }
  const repo = new Stub();
  assert.strictEqual(repo.get('x'), 'got:x');
});
