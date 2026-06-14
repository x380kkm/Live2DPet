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
  applyTones
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

//// 音节拼成片假名:声母拼到韵母首元音上 [@busybee 2026-06-15] ////
test('syllableToKana 拼出近似片假名', () => {
  const k = (raw) => syllableToKana(parsePinyin(raw)).kana;
  assert.strictEqual(k('ni3'), 'ニ');
  assert.strictEqual(k('hao3'), 'ハオ');
  assert.strictEqual(k('wo3'), 'ウォ');
  assert.strictEqual(k('shi4'), 'シ');
  assert.strictEqual(k('zhuo1'), 'ジュオ');
  assert.strictEqual(k('mian4'), 'ミェン');
  assert.strictEqual(k('xing4'), 'シン');
  // 卷舌 zh 与平舌 z 区别在 i:zhi→ジ、zi→ズ
  assert.strictEqual(k('zhi1'), 'ジ');
  assert.strictEqual(k('zi4'), 'ズ');
});

//// 未知韵母跳过,不拼出也不抛 [@busybee 2026-06-15] ////
test('syllableToKana 未知韵母回 ok:false', () => {
  const out = syllableToKana({ initial: 'b', final: 'zzz' });
  assert.strictEqual(out.ok, false);
  assert.strictEqual(out.kana, '');
});

//// 整句拼接成片假名串与声调计划,标点转日文逗号句号 [@busybee 2026-06-15] ////
test('sentenceToKana 拼整句与声调计划', () => {
  const { kana, plan } = sentenceToKana(['ni3', 'hao3', '，', 'ma5', '。']);
  assert.strictEqual(kana, 'ニハオ、マ。');
  assert.strictEqual(plan.length, 3);
  assert.deepStrictEqual(plan.map((p) => p.tone), [3, 3, 5]);
  assert.deepStrictEqual(plan.map((p) => p.kana), ['ニ', 'ハオ', 'マ']);
});

//// 四声调型形状:一声高平、四声多音下降、三声单音压低,且夹在区间内 [@busybee 2026-06-15] ////
test('toneContour 各声调形状与夹紧', () => {
  const base = 5.8;
  const t1 = toneContour(1, 2, base);
  assert.ok(t1.every((p) => Math.abs(p - (base + 0.30)) < 1e-9), '一声高平');

  const t4 = toneContour(4, 3, base);
  assert.ok(t4[0] > t4[2], '四声多音应下降');

  const t2 = toneContour(2, 3, base);
  assert.ok(t2[0] < t2[2], '二声多音应上升');

  assert.deepStrictEqual(toneContour(3, 1, base), [base - 0.40], '三声单音压低');

  // 夹在 [4.8, 6.6]
  const extreme = toneContour(4, 2, 6.5);
  assert.ok(extreme.every((p) => p >= 4.8 && p <= 6.6));
});

//// 按 mora 文本覆盖对齐:引擎把 ドゥ 拆成两拍也不串调 [@busybee 2026-06-15] ////
test('applyTones 按片假名覆盖对齐,容忍引擎拆拍', () => {
  // 计划:du(一声)+ ni(四声);query 把 ドゥ 拆成 ド+ゥ 两拍
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
  // base=5.8:一声两拍都抬到 6.1,四声单拍代表值 6.12
  assert.ok(Math.abs(moras[0].pitch - 6.10) < 1e-6, '吞下 ド 属第一音节一声');
  assert.ok(Math.abs(moras[1].pitch - 6.10) < 1e-6, '吞下 ゥ 仍属第一音节,未串到第二音节');
  assert.ok(Math.abs(moras[2].pitch - 6.12) < 1e-6, 'ニ 属第二音节四声');
});

//// 不改无声 mora 的音高 [@busybee 2026-06-15] ////
test('applyTones 跳过无声 mora', () => {
  const plan = [{ kana: 'シ', tone: 1 }];
  const query = { accent_phrases: [{ moras: [{ text: 'シ', pitch: 0 }] }] };
  applyTones(query, plan);
  assert.strictEqual(query.accent_phrases[0].moras[0].pitch, 0);
});
