// audience: internal
// # word-segmenter.test
// 验证 jieba 分词把专名成语整体保留、标点单列,以及 LLM 纠错用的 parseMerges 解析与 applyMerges 合并。
// 运行: node --test tests/domain/word-segmenter.test.js

const { test } = require('node:test');
const assert = require('node:assert');
const { segmentWords, parseMerges, applyMerges } = require('../../src/domain/tts/word-segmenter');

//// jieba 分词:专名成语整体保留,标点单列,音节数按汉字计 [@x380kkm 2026-06-17] ////
test('segmentWords 分词与单元', () => {
  const u = segmentWords('硕大无朋的罗生门，正下方');
  const words = u.filter((x) => x.word != null).map((x) => x.word);
  // 罗生门、硕大无朋 应整体保留(pinyin-pro 会切成单字)
  assert.ok(words.includes('罗生门'), '罗生门整体保留');
  assert.ok(words.includes('硕大无朋'), '硕大无朋整体保留');
  // 逗号作为标点单元单列
  assert.ok(u.some((x) => x.punct === '，'), '逗号单列为标点单元');
  // 音节数按汉字个数
  const luo = u.find((x) => x.word === '罗生门');
  assert.strictEqual(luo.sylls, 3, '罗生门三音节');
});

//// parseMerges:从 JSON 回应解析合并区间,容错非法项 [@x380kkm 2026-06-17] ////
test('parseMerges 解析合并区间', () => {
  assert.deepStrictEqual(parseMerges('{"merges":[[2,3],[5,7]]}'), [[2, 3], [5, 7]]);
  // 回应带前后说明文字也能取出 JSON
  assert.deepStrictEqual(parseMerges('好的:{"merges":[[0,1]]} 完成'), [[0, 1]]);
  // 非法项(单元素、起止相等、非整数)被滤掉
  assert.deepStrictEqual(parseMerges('{"merges":[[1],[3,3],[4,2],[6,7]]}'), [[6, 7]]);
  // 解析失败或无 merges 回空数组
  assert.deepStrictEqual(parseMerges('没有 JSON'), []);
  assert.deepStrictEqual(parseMerges('{"x":1}'), []);
});

//// applyMerges:按区间合并相邻词、音节相加,标点不并、越界与重叠跳过 [@x380kkm 2026-06-17] ////
test('applyMerges 合并相邻词', () => {
  const units = [
    { word: '头戴', sylls: 2 }, { word: '巨大', sylls: 2 }, { word: '市', sylls: 1 }, { word: '女笠', sylls: 2 },
  ];
  // 合并 2-3(市+女笠)→ 市女笠
  const out = applyMerges(units, [[2, 3]]);
  assert.deepStrictEqual(out.map((u) => u.word), ['头戴', '巨大', '市女笠']);
  assert.strictEqual(out[2].sylls, 3, '合并后音节相加');
  // 越界区间跳过,不抛
  assert.deepStrictEqual(applyMerges(units, [[2, 9]]).map((u) => u.word), ['头戴', '巨大', '市', '女笠']);
  // 标点不参与合并:含标点的区间跳过
  const withPunct = [{ word: '甲', sylls: 1 }, { punct: '，' }, { word: '乙', sylls: 1 }];
  assert.deepStrictEqual(applyMerges(withPunct, [[0, 2]]).length, 3, '跨标点的合并被跳过');
  // 空合并原样返回
  assert.deepStrictEqual(applyMerges(units, []).map((u) => u.word), ['头戴', '巨大', '市', '女笠']);
});
