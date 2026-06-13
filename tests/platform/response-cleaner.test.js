// 运行:node --test tests/platform/response-cleaner.test.js
const { test } = require('node:test');
const assert = require('node:assert');
const { cleanResponse } = require('../../src/platform/llm/response-cleaner');

test('剥离闭合的 think 与 thinking 标签', () => {
  const input = '<think>盘算一下</think>你好<thinking>再想想</thinking>世界';
  assert.strictEqual(cleanResponse(input), '你好世界');
});

test('剥离未闭合的 think 标签直到文本末尾', () => {
  const input = '答案在这<think>后面被截断了没有闭合';
  assert.strictEqual(cleanResponse(input), '答案在这');
});

test('把三行及以上的连续空行归并为一个空行', () => {
  const input = '第一段\n\n\n\n第二段';
  assert.strictEqual(cleanResponse(input), '第一段\n\n第二段');
});

test('标签大小写不敏感', () => {
  const input = '<THINK>X</THINK>正文';
  assert.strictEqual(cleanResponse(input), '正文');
});

test('不改变没有怪癖的语义内容,仅去首尾空白', () => {
  const input = '  普通回复  ';
  assert.strictEqual(cleanResponse(input), '普通回复');
});

test('空输入原样返回', () => {
  assert.strictEqual(cleanResponse(''), '');
  assert.strictEqual(cleanResponse(null), null);
  assert.strictEqual(cleanResponse(undefined), undefined);
});
