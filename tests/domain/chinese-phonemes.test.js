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
  sentenceToAccentKana,
  mandarinTone,
  applyMandarinTones,
  toneContour,
  applyTones,
  flowPhrases,
  shapeChineseRhythm
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
  // ian 用全角エ(避免 t/d+ian 出双小假名):mian→ミエン
  assert.strictEqual(k('mian4'), 'ミエン');
  // -ng 与 -n 都收到 ン(补长音会拖慢连读):xing→シン、chong→チョン
  assert.strictEqual(k('xing4'), 'シン');
  assert.strictEqual(k('chong3'), 'チョン');
  // 卷舌 zh 与平舌 z 区别在 i:zhi→ジー、zi→ズー
  assert.strictEqual(k('zhi1'), 'ジー');
  assert.strictEqual(k('zi4'), 'ズー');
  // ü 韵母:声母拼到 ü 列(单元音 ü 默认路线补长音ー);去 qù→チュー、学 xué→シュエ、女 nǚ→ニュー、月 yuè→ユエ
  assert.strictEqual(k('qu4'), 'チュー');
  assert.strictEqual(k('xue2'), 'シュエ');
  assert.strictEqual(k('nv3'), 'ニュー');
  assert.strictEqual(k('yue4'), 'ユエ');
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

//// 整句拼成 AquesTalk 带重音片假名与声调计划:停顿组并成一个短语连读、组间 、停顿,不带长音ー [@busybee 2026-06-15] ////
test('sentenceToAccentKana 按停顿组并短语拼带重音片假名与计划', () => {
  // 默认不变调、不补拍(补拍拉低识别率):ni→ニ、hao→ハオ、ma→マ
  const { kana, plan } = sentenceToAccentKana(['ni3', 'hao3', '，', 'ma5', '。']);
  // 你好并成一个短语(重音核置末仅供解析),逗号处断成另一组
  assert.strictEqual(kana, "ニハオ'、マ'");
  assert.ok(!kana.includes('ー'), '不含长音ー(AquesTalk 不收)');
  assert.ok(!kana.includes('/'), '组内不再切短语');
  assert.deepStrictEqual(plan.map((p) => p.tone), [3, 3, 5]);
  assert.deepStrictEqual(plan.map((p) => p.kana), ['ニ', 'ハオ', 'マ']);
  // 显式开补拍则单元音补一拍(ニ→ニイ)
  assert.strictEqual(sentenceToAccentKana(['ni3'], { elongate: true }).kana, "ニイ'");
  // 显式开变调时,前一个三声读二声
  assert.deepStrictEqual(sentenceToAccentKana(['ni3', 'hao3'], { sandhi: true }).plan.map((p) => p.tone), [2, 3]);
  // 停顿组首音节标 groupStart,逗号后重置
  assert.deepStrictEqual(
    sentenceToAccentKana(['ni3', 'hao3', '，', 'ma5']).plan.map((p) => p.groupStart),
    [true, false, true]
  );
});

//// 普通话四声目标音高:一声高平、二声升、三声低、四声降 [@busybee 2026-06-15] ////
test('mandarinTone 四声调值走势', () => {
  const base = 5.75;
  const t1 = mandarinTone(1, 2, base);
  assert.ok(t1[0] === t1[1] && t1[0] > base, '一声高平');
  const t2 = mandarinTone(2, 2, base);
  assert.ok(t2[1] > t2[0], '二声升');
  const t3 = mandarinTone(3, 2, base);
  assert.ok(t3[0] < base && t3[1] < t3[0], '三声低且下压');
  const t4 = mandarinTone(4, 2, base);
  assert.ok(t4[0] > t4[1] && t4[0] > base, '四声降且起点高');
  // 非句末连读协同:半四声只降到中位(不到 LOW)、半三声低平不下潜
  const t4mid = mandarinTone(4, 2, base, false);
  assert.ok(Math.abs(t4mid[1] - base) < 1e-9, '非句末四声只半降到中位');
  assert.ok(t4mid[1] > mandarinTone(4, 2, base, true)[1], '非句末四声尾比句末四声高');
  const t3half = mandarinTone(3, 2, base, false);
  assert.ok(t3half[0] === t3half[1] && t3half[0] < base, '非句末三声低平');
  assert.ok(t3half[1] > mandarinTone(3, 2, base, true)[1], '半三声不像句末三声那样下潜到底');
  // 单拍取关键调值:三声压低、其余抬高
  assert.ok(mandarinTone(3, 1, base)[0] < base);
  assert.ok(mandarinTone(1, 1, base)[0] > base);
  // 轻声压到中低位,落在三声(低位)之上但不冒到基准之上,免得「你的」从低位猛跳显突兀
  const neutral = mandarinTone(5, 1, base)[0];
  assert.ok(neutral < base && neutral > mandarinTone(3, 1, base)[0], '轻声居于三声低位与基准之间');
});

//// 停顿组内逐音节语调下倾,句末音节豁免下倾 [@busybee 2026-06-15] ////
test('applyMandarinTones 组内下倾,句末豁免', () => {
  // 三个一声同组:句首、中段、句末;关掉边界平滑(blend:0)单看下倾
  const plan = [
    { kana: 'ガ', tone: 1, groupStart: true },
    { kana: 'ガ', tone: 1, groupStart: false },
    { kana: 'ガ', tone: 1, groupStart: false }
  ];
  const query = { accent_phrases: [{ moras: [
    { text: 'ガ', pitch: 5.8 }, { text: 'ガ', pitch: 5.8 }, { text: 'ガ', pitch: 5.8 }
  ] }] };
  applyMandarinTones(query, plan, { blend: 0 });
  const [a, b, c] = query.accent_phrases[0].moras.map((m) => m.pitch);
  assert.ok(b < a, '中段音节因下倾比句首低');
  assert.ok(c > b, '句末音节豁免下倾,不被继续压低');
});

//// 边界平滑软化相邻音节交界的硬跳:高拍被拉低、低拍被抬高,差变小 [@busybee 2026-06-15] ////
test('applyMandarinTones 边界平滑软化交界', () => {
  const make = () => ({ accent_phrases: [{ moras: [
    { text: 'ガ', pitch: 5.8 }, { text: 'ニ', pitch: 5.8 }
  ] }] });
  // 一声(高)接句末三声(低),交界处有硬跳
  const plan = [
    { kana: 'ガ', tone: 1, groupStart: true },
    { kana: 'ニ', tone: 3, groupStart: false }
  ];
  const sharp = make(); applyMandarinTones(sharp, plan, { blend: 0 });
  const soft = make(); applyMandarinTones(soft, plan, { blend: 0.34 });
  const [sa, sb] = sharp.accent_phrases[0].moras.map((m) => m.pitch);
  const [na, nb] = soft.accent_phrases[0].moras.map((m) => m.pitch);
  assert.ok(Math.abs(na - nb) < Math.abs(sa - sb), '平滑后交界两拍音高差变小');
  assert.ok(na < sa && nb > sb, '高拍被拉低、低拍被抬高');
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

//// 节奏整形:合并停顿组内的相邻短语让组内连读、收紧标点停顿,不动元辅音时长 [@busybee 2026-06-15] ////
test('shapeChineseRhythm 合并组内短语并收紧停顿', () => {
  const query = {
    accent_phrases: [
      // 组内两个无停顿相邻短语:应合并
      { moras: [{ text: 'ジュ', consonant_length: 0.08, vowel_length: 0.06, pitch: 6.0 }], accent: 1, pause_mora: null },
      { moras: [{ text: 'ウ', consonant_length: 0, vowel_length: 0.11, pitch: 6.0 }], accent: 1, pause_mora: { vowel_length: 0.40 } },
      // 停顿后的另一组
      { moras: [{ text: 'マ', consonant_length: 0.20, vowel_length: 0.08, pitch: 5.5 }], accent: 1, pause_mora: null }
    ]
  };
  shapeChineseRhythm(query);
  // 前两个无停顿相邻短语合并成一个,停顿后断开:共两个短语
  assert.strictEqual(query.accent_phrases.length, 2);
  assert.deepStrictEqual(query.accent_phrases[0].moras.map((m) => m.text), ['ジュ', 'ウ']);
  // 标点停顿从 0.40 收到 0.20
  assert.strictEqual(query.accent_phrases[0].pause_mora.vowel_length, 0.20);
  // 不动各 mora 的元辅音时长(实测抻长元音、压短辅音都会拉低识别率)
  assert.strictEqual(query.accent_phrases[0].moras[0].vowel_length, 0.06);
  assert.strictEqual(query.accent_phrases[0].moras[1].vowel_length, 0.11);
  assert.strictEqual(query.accent_phrases[1].moras[0].consonant_length, 0.20);
});

//// 不改无声 mora 的音高 [@busybee 2026-06-15] ////
test('applyTones 跳过无声 mora', () => {
  const plan = [{ kana: 'シ', tone: 1 }];
  const query = { accent_phrases: [{ moras: [{ text: 'シ', pitch: 0 }] }] };
  applyTones(query, plan);
  assert.strictEqual(query.accent_phrases[0].moras[0].pitch, 0);
});
