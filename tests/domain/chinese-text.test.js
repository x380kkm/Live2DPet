// audience: internal
// # chinese-text.test
// 验证任意中文文本转拼音 token:声调数字、轻声归 5、多音字按词消歧、标点保留、非汉字跳过,以及转片假名贯通。
// 运行: node --test tests/domain/chinese-text.test.js

const { test } = require('node:test');
const assert = require('node:assert');
const { textToPinyinTokens, textToAccentKana, classifySentenceType, predictProsodicBreaks } = require('../../src/domain/tts/chinese-text');

//// 汉字转带声调拼音,轻声归 5 [@x380kkm 2026-06-15] ////
test('textToPinyinTokens 基本转换与轻声', () => {
  assert.deepStrictEqual(textToPinyinTokens('你好'), ['ni3', 'hao3']);
  // 轻声 pinyin-pro 记 0,这里统一成 5(们、的)
  assert.deepStrictEqual(textToPinyinTokens('我们的'), ['wo3', 'men5', 'de5']);
});

//// 多音字按词消歧 [@x380kkm 2026-06-15] ////
test('textToPinyinTokens 多音字按上下文', () => {
  assert.deepStrictEqual(textToPinyinTokens('银行'), ['yin2', 'hang2']);
  assert.deepStrictEqual(textToPinyinTokens('行走'), ['xing2', 'zou3']);
  assert.deepStrictEqual(textToPinyinTokens('重要'), ['zhong4', 'yao4']);
  assert.deepStrictEqual(textToPinyinTokens('重复'), ['chong2', 'fu4']);
});

//// 标点保留、非汉字(拉丁字母、数字、空格、符号)跳过 [@x380kkm 2026-06-15] ////
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

//// 据疑问词与句末标点判句类型 [@x380kkm 2026-06-16] ////
test('classifySentenceType 判句类型', () => {
  assert.strictEqual(classifySentenceType('你吃饭了吗？'), 'ynQuestion', '吗 加问号是是非问');
  assert.strictEqual(classifySentenceType('你吃饭了吗'), 'ynQuestion', '句末吗无标点也是是非问');
  assert.strictEqual(classifySentenceType('你想吃什么？'), 'whQuestion', '含疑问词什么是特指问');
  assert.strictEqual(classifySentenceType('你想吃什么'), 'whQuestion', '含疑问词即特指问,不靠问号');
  assert.strictEqual(classifySentenceType('我已经吃过了。'), 'statement', '无疑问词无问号是陈述');
  assert.strictEqual(classifySentenceType('太好了！'), 'exclamation', '叹号是感叹');
});

//// 文本直通片假名与声调计划 [@x380kkm 2026-06-15] ////
test('textToAccentKana 贯通到片假名,默认应用三声变调', () => {
  const { kana, plan } = textToAccentKana('你好');
  // 默认补拍:单元音「你」ni→ニイ,「好」hao 复韵母不补
  assert.strictEqual(kana, "ニイハオ'");
  // 三声变调:你好两个三声,前一个「你」变二声,念 ní hǎo
  assert.deepStrictEqual(plan.map((p) => p.tone), [2, 3]);
  // 显式关掉变调则保留原调
  assert.deepStrictEqual(textToAccentKana('你好', { sandhi: false }).plan.map((p) => p.tone), [3, 3]);
});

//// 多句逐段标句类型:按句末终止标点切句,每句的音节标各自的句类型,句末音节标 sentenceEnd [@x380kkm 2026-06-17] ////
test('textToAccentKana 多句逐段标句类型', () => {
  // 「你好吗？我很好。」:前三音节(你好吗)是是非问,后三(我很好)是陈述。
  const { plan } = textToAccentKana('你好吗？我很好。');
  assert.strictEqual(plan.length, 6, '六个音节,标点不计');
  assert.strictEqual(plan[0].sentenceType, 'ynQuestion', '第一句是非问');
  assert.strictEqual(plan[2].sentenceType, 'ynQuestion', '吗 属第一句');
  assert.ok(plan[2].sentenceEnd, '第一句末音节标 sentenceEnd');
  assert.strictEqual(plan[3].sentenceType, 'statement', '第二句陈述');
  assert.strictEqual(plan[5].sentenceType, 'statement', '好 属第二句');
  assert.ok(plan[5].sentenceEnd, '第二句末音节标 sentenceEnd');
  assert.ok(!plan[0].sentenceEnd && !plan[3].sentenceEnd, '非句末不标 sentenceEnd');
});

//// 焦点标记:文本里 *词* 标的焦点词在计划对应音节上标 focus,星号不进发音 [@x380kkm 2026-06-17] ////
test('textToAccentKana 焦点标记', () => {
  // 「我要*这个*」:这个是焦点,对应第 2、3 个音节(下标 2、3)。
  const { plan } = textToAccentKana('我要*这个*');
  assert.strictEqual(plan.length, 4, '四个音节,星号不计入');
  assert.ok(!plan[0].focus && !plan[1].focus, '焦点前不标');
  assert.ok(plan[2].focus && plan[3].focus, '焦点词两个音节都标 focus');
  // 无标记则都不标。
  const { plan: p2 } = textToAccentKana('我要这个');
  assert.ok(p2.every((p) => !p.focus), '无星号则无焦点');
});

//// 韵律边界预测:标点定语调短语、顿号半停、后附虚词连读、按音节数软切韵律短语、领头虚词不切 [@x380kkm 2026-06-17] ////
test('predictProsodicBreaks 确定性定边界', () => {
  // 标点:句号定语调短语(全停),其前在长度内不另切。
  const a = predictProsodicBreaks([{ word: '你好', sylls: 2 }, { word: '世界', sylls: 2 }, { punct: '。' }]);
  assert.deepStrictEqual(a, ['none', 'none', 'IP'], '四音节一短语,句末全停');
  // 顿号降为韵律短语半停,句号全停。
  const b = predictProsodicBreaks([{ word: '苹果', sylls: 2 }, { punct: '、' }, { word: '香蕉', sylls: 2 }, { punct: '。' }]);
  assert.strictEqual(b[1], 'PPh', '顿号半停');
  assert.strictEqual(b[3], 'IP', '句号全停');
  // 后附虚词「的」与单音节字连读进左侧韵律词,内部标 PW(不停)。
  const c = predictProsodicBreaks([{ word: '我', sylls: 1 }, { word: '的', sylls: 1 }, { word: '书', sylls: 1 }]);
  assert.deepStrictEqual(c, ['PW', 'PW', 'none'], '我的书连读成一个韵律词');
  // 长块按累计音节数软切:五个双音节词切成 4-4-2 三段(两处韵律短语半停)。
  const d = predictProsodicBreaks([
    { word: '昨天', sylls: 2 }, { word: '晚上', sylls: 2 }, { word: '我们', sylls: 2 },
    { word: '看见', sylls: 2 }, { word: '流星', sylls: 2 }, { punct: '。' },
  ]);
  assert.strictEqual(d[1], 'PPh', '晚上后半停(昨天晚上一段)');
  assert.strictEqual(d[3], 'PPh', '看见后半停(我们看见一段)');
  assert.strictEqual(d[5], 'IP', '句末全停');
  // 领头虚词「把」前后不切:他把书放下整体不出现韵律短语停顿。
  const e = predictProsodicBreaks([
    { word: '他', sylls: 1 }, { word: '把', sylls: 1 }, { word: '书', sylls: 1 },
    { word: '放下', sylls: 2 }, { punct: '。' },
  ]);
  assert.ok(!e.slice(0, 4).includes('PPh'), '领头虚词把前后不切韵律短语');
  assert.strictEqual(e[4], 'IP', '句末全停');
});
