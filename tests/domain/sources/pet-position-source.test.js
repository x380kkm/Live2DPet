// audience: internal
// # pet-position-source.test
// 运行: node --test tests/domain/sources/pet-position-source.test.js
// 验证宠物位置源契约:id 取引用名、坐标与尺寸代入模板、字段不全返回 null、按字符数估 token。

const { test } = require('node:test');
const assert = require('node:assert');
const { ContextSource } = require('../../../src/domain/pet/context-source');
const { PetPositionSource } = require('../../../src/domain/pet/sources/pet-position-source');

test('id 默认取意图引用名 petPosition 且为上下文源', () => {
  const source = new PetPositionSource({ boundsProvider: () => null });
  assert.strictEqual(source.id, 'petPosition');
  assert.ok(source instanceof ContextSource);
});

test('render 把坐标与尺寸代入标签模板', () => {
  const source = new PetPositionSource(
    { boundsProvider: () => ({ x: 100, y: 200, width: 300, height: 400 }) },
    { labelTemplate: '屏幕({x},{y})，大小{w}x{h}' }
  );
  assert.strictEqual(source.render({}), '屏幕(100,200)，大小300x400');
});

test('render 缺省模板给紧凑回退串', () => {
  const source = new PetPositionSource({
    boundsProvider: () => ({ x: 10, y: 20, width: 30, height: 40 })
  });
  assert.strictEqual(source.render({}), '(10,20) 30x40');
});

test('render 坐标取零时如实代入', () => {
  const source = new PetPositionSource({
    boundsProvider: () => ({ x: 0, y: 0, width: 50, height: 60 })
  });
  assert.strictEqual(source.render({}), '(0,0) 50x60');
});

test('render 无边界返回 null', () => {
  const source = new PetPositionSource({ boundsProvider: () => null });
  assert.strictEqual(source.render({}), null);
});

test('render 字段不全返回 null', () => {
  const source = new PetPositionSource({ boundsProvider: () => ({ x: 1, y: 2, width: 3 }) });
  assert.strictEqual(source.render({}), null);
});

test('render 字段非有限数返回 null', () => {
  const source = new PetPositionSource({
    boundsProvider: () => ({ x: 1, y: 2, width: 3, height: NaN })
  });
  assert.strictEqual(source.render({}), null);
});

test('render 缺取数函数返回 null', () => {
  const source = new PetPositionSource({});
  assert.strictEqual(source.render({}), null);
});

test('estimateTokens 据渲染片段字符数粗估', () => {
  const source = new PetPositionSource({
    boundsProvider: () => ({ x: 1, y: 2, width: 3, height: 4 })
  }); // "(1,2) 3x4" 9 字符 → 3 token
  assert.strictEqual(source.estimateTokens({}), 3);
});

test('estimateTokens 无边界为 0', () => {
  const source = new PetPositionSource({ boundsProvider: () => null });
  assert.strictEqual(source.estimateTokens({}), 0);
});
