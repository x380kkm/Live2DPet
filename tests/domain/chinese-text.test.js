// audience: internal
// # chinese-text.test
// 验证任意中文文本转拼音 token:声调数字、轻声归 5、多音字按词消歧、标点保留、非汉字跳过,以及转片假名贯通。
// 运行: node --test tests/domain/chinese-text.test.js

const { test } = require('node:test');
const assert = require('node:assert');
const { textToPinyinTokens, textToAccentKana } = require('../../src/domain/tts/chinese-text');

//// 汉字转带声调拼音,轻声归 5 [@busybee 2026-06-15] ////
test('textToPinyinTokens 基本转换与轻声', () => {
  assert.deepStrictEqual(textToPinyinTokens('你好'), ['ni3', 'hao3']);
  // 轻声 pinyin-pro 记 0,这里统一成 5(们、的)
  assert.deepStrictEqual(textToPinyinTokens('我们的'), ['wo3', 'men5', 'de5']);
});

//// 多音字按词消歧 [@busybee 2026-06-15] ////
test('textToPinyinTokens 多音字按上下文', () => {
  assert.deepStrictEqual(textToPinyinTokens('银行'), ['yin2', 'hang2']);
  assert.deepStrictEqual(textToPinyinTokens('行走'), ['xing2', 'zou3']);
  assert.deepStrictEqual(textToPinyinTokens('重要'), ['zhong4', 'yao4']);
  assert.deepStrictEqual(textToPinyinTokens('重复'), ['chong2', 'fu4']);
});

//// 标点保留、非汉字(拉丁字母、数字、空格、符号)跳过 [@busybee 2026-06-15] ////
test('textToPinyinTokens 标点保留、非汉字跳过', () => {
  assert.deepStrictEqual(
    textToPinyinTokens('你好，世界。'),
    ['ni3', 'hao3', '，', 'shi4', 'jie4', '。']
  );
  // OK、数字、百分号都不发音,只留汉字
  assert.deepStrictEqual(textToPinyinTokens('OK 没问题'), ['mei2', 'wen4', 'ti2']);
  assert.deepStrictEqual(textToPinyinTokens('我有 3 个'), ['wo3', 'you3', 'ge4']);
  // 空串与纯符号回空数组,不抛
  assert.deepStrictEqual(textToPinyinTokens(''), []);
  assert.deepStrictEqual(textToPinyinTokens('123 %#'), []);
});

//// 文本直通片假名与声调计划 [@busybee 2026-06-15] ////
test('textToAccentKana 贯通到片假名', () => {
  const { kana, plan } = textToAccentKana('你好');
  assert.strictEqual(kana, "ニハオ'");
  assert.deepStrictEqual(plan.map((p) => p.tone), [3, 3]);
});
