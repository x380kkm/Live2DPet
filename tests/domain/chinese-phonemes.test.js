// audience: internal
// # chinese-phonemes.test
// 验证中文凑音素层:拼音拆解、音节拼片假名、整句拼接与声调计划、四声调型形状、按 mora 文本覆盖对齐改音高。
// 运行: node --test tests/domain/chinese-phonemes.test.js

const { test } = require('node:test');
const assert = require('node:assert');
const {
  parsePinyin,
  syllableToKana,
  sentenceToKana,
  toneContour,
  applyTones,
  flowPhrases,
  shapeFlow
} = require('../../src/domain/tts/chinese-phonemes');

//// 拼音拆成声母、韵母、声调,j/q/x/y 后的 u 当 ü [@busybee 2026-06-15] ////
test('parsePinyin 拆声母韵母声调', () => {
  assert.deepStrictEqual(parsePinyin('hao3'), { initial: 'h', final: 'ao', tone: 3, body: 'hao' });
  assert.deepStrictEqual(parsePinyin('shi4'), { initial: 'sh', final: 'i', tone: 4, body: 'shi' });
  assert.deepStrictEqual(parsePinyin('a'), { initial: '', final: 'a', tone: 5, body: 'a' });
  // ju 实为 jü
  assert.strictEqual(parsePinyin('ju2').final, 'ü');
  assert.strictEqual(parsePinyin('ju2').tone, 2);
});

//// 音节拼成片假名:声母拼到韵母首元音上,单元音补长音、轻声不补 [@busybee 2026-06-15] ////
test('syllableToKana 拼出近似片假名并补长音', () => {
  const k = (raw) => syllableToKana(parsePinyin(raw)).kana;
  // 单元音韵母补长音ー
  assert.strictEqual(k('ni3'), 'ニー');
  assert.strictEqual(k('wo3'), 'ウォー');
  assert.strictEqual(k('shi4'), 'シー');
  // 复元音、鼻韵尾不补长音(本就两拍以上)
  assert.strictEqual(k('hao3'), 'ハオ');
  assert.strictEqual(k('zhuo1'), 'ジュオ');
  assert.strictEqual(k('mian4'), 'ミェン');
  assert.strictEqual(k('xing4'), 'シン');
  // 卷舌 zh 与平舌 z 区别在 i:zhi→ジー、zi→ズー
  assert.strictEqual(k('zhi1'), 'ジー');
  assert.strictEqual(k('zi4'), 'ズー');
  // 轻声不补长音
  assert.strictEqual(k('de5'), 'ドゥ');
  assert.strictEqual(k('ma5'), 'マ');
});

//// 未知韵母跳过,不拼出也不抛 [@busybee 2026-06-15] ////
test('syllableToKana 未知韵母回 ok:false', () => {
  const out = syllableToKana({ initial: 'b', final: 'zzz' });
  assert.strictEqual(out.ok, false);
  assert.strictEqual(out.kana, '');
});

//// 整句拼接成片假名串与声调计划,三声变调、长音、标点转日文逗号句号 [@busybee 2026-06-15] ////
test('sentenceToKana 拼整句、三声变调与长音', () => {
  // ni3 hao3 相邻两三声,前一个变二声;ni 单元音补长音、轻声 ma 不补
  const { kana, plan } = sentenceToKana(['ni3', 'hao3', '，', 'ma5', '。']);
  assert.strictEqual(kana, 'ニーハオ、マ。');
  assert.strictEqual(plan.length, 3);
  assert.deepStrictEqual(plan.map((p) => p.tone), [2, 3, 5]);
  assert.deepStrictEqual(plan.map((p) => p.kana), ['ニー', 'ハオ', 'マ']);
});

//// 三声变调不跨标点,标点断开则重置 [@busybee 2026-06-15] ////
test('sentenceToKana 三声变调不跨标点', () => {
  // 两个三声被逗号隔开,不变调
  const { plan } = sentenceToKana(['hao3', '，', 'ni3']);
  assert.deepStrictEqual(plan.map((p) => p.tone), [3, 3]);
  // 连续三个三声变成 二 二 三
  const { plan: p3 } = sentenceToKana(['wo3', 'hen3', 'hao3']);
  assert.deepStrictEqual(p3.map((p) => p.tone), [2, 2, 3]);
});

//// 四声微调量是相对 0 的轻微偏置:一声略抬、四声尾降、二声尾升、三声压低 [@busybee 2026-06-15] ////
test('toneContour 各声调微调走势', () => {
  const t1 = toneContour(1, 2);
  assert.ok(t1.every((d) => Math.abs(d - 0.12) < 1e-9), '一声略抬且平');

  const t4 = toneContour(4, 3);
  assert.ok(t4[0] > t4[2], '四声多音偏置应由高到低');

  const t2 = toneContour(2, 3);
  assert.ok(t2[0] < t2[2], '二声多音偏置应由低到高');

  assert.deepStrictEqual(toneContour(3, 1), [-0.18], '三声单音压低');
  // 偏置量都很轻微(绝对值不超过 0.25)
  assert.ok([t1, t4, t2].flat().every((d) => Math.abs(d) <= 0.25));
});

//// 按 mora 文本覆盖对齐,只在引擎音高上叠轻微偏置,容忍引擎拆拍 [@busybee 2026-06-15] ////
test('applyTones 叠偏置且按片假名覆盖对齐', () => {
  // 计划:du(一声)+ ni(四声);query 把 ドゥ 拆成 ド+ゥ 两拍,引擎音高 5.8
  const plan = [{ kana: 'ドゥ', tone: 1 }, { kana: 'ニ', tone: 4 }];
  const query = {
    accent_phrases: [{
      moras: [
        { text: 'ド', pitch: 5.8 },
        { text: 'ゥ', pitch: 5.8 },
        { text: 'ニ', pitch: 5.8 }
      ]
    }]
  };
  applyTones(query, plan);
  const moras = query.accent_phrases[0].moras;
  // 一声两拍各叠 +0.12;四声单拍叠 +0.10
  assert.ok(Math.abs(moras[0].pitch - 5.92) < 1e-6, '吞下 ド 属第一音节,叠一声偏置');
  assert.ok(Math.abs(moras[1].pitch - 5.92) < 1e-6, '吞下 ゥ 仍属第一音节,未串到第二音节');
  assert.ok(Math.abs(moras[2].pitch - 5.90) < 1e-6, 'ニ 属第二音节,叠四声偏置');
});

//// strength 缩放偏置强度 [@busybee 2026-06-15] ////
test('applyTones strength 缩放偏置', () => {
  const plan = [{ kana: 'ニ', tone: 1 }];
  const query = { accent_phrases: [{ moras: [{ text: 'ニ', pitch: 5.8 }] }] };
  applyTones(query, plan, { strength: 0.5 });
  // 一声单拍偏置 +0.12,半强度即 +0.06
  assert.ok(Math.abs(query.accent_phrases[0].moras[0].pitch - 5.86) < 1e-6);
});

//// 合并停顿组内的多个 accent_phrase,只在停顿处断开 [@busybee 2026-06-15] ////
test('flowPhrases 合并无停顿相邻 phrase', () => {
  const query = {
    accent_phrases: [
      { moras: [{ text: 'ニ', pitch: 5.8 }], accent: 1, pause_mora: null },
      { moras: [{ text: 'ハ', pitch: 5.8 }], accent: 1, pause_mora: { vowel_length: 0.3 } },
      { moras: [{ text: 'オ', pitch: 5.8 }], accent: 1, pause_mora: null }
    ]
  };
  flowPhrases(query);
  // 前两个间无停顿合并;第二个后有停顿,与第三个断开
  assert.strictEqual(query.accent_phrases.length, 2);
  assert.deepStrictEqual(query.accent_phrases[0].moras.map((m) => m.text), ['ニ', 'ハ']);
  assert.deepStrictEqual(query.accent_phrases[1].moras.map((m) => m.text), ['オ']);
});

//// 时长整形:抻长元音、压短辅音、收紧停顿 [@busybee 2026-06-15] ////
test('shapeFlow 抻长元音压短辅音收紧停顿', () => {
  const query = {
    accent_phrases: [{
      moras: [{ text: 'ニ', consonant_length: 0.10, vowel_length: 0.10, pitch: 5.8 }],
      pause_mora: { vowel_length: 0.40 }
    }]
  };
  shapeFlow(query, { vowelFloor: 0.16, vowelScale: 1.5, consonantCap: 0.05, pauseCap: 0.22 });
  const mora = query.accent_phrases[0].moras[0];
  assert.strictEqual(mora.vowel_length, 0.16); // max(0.16, 0.10*1.5=0.15)
  assert.strictEqual(mora.consonant_length, 0.05); // min(0.10, 0.05)
  assert.strictEqual(query.accent_phrases[0].pause_mora.vowel_length, 0.22); // min(0.40, 0.22)
});

//// 不改无声 mora 的音高 [@busybee 2026-06-15] ////
test('applyTones 跳过无声 mora', () => {
  const plan = [{ kana: 'シ', tone: 1 }];
  const query = { accent_phrases: [{ moras: [{ text: 'シ', pitch: 0 }] }] };
  applyTones(query, plan);
  assert.strictEqual(query.accent_phrases[0].moras[0].pitch, 0);
});
