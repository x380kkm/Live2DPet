// audience: internal
// # chinese-phonemes.test
// 验证中文凑音素层:拼音拆解、音节拼片假名、整句拼接与声调计划、四声调型形状、按 mora 文本覆盖对齐改音高。
// 运行: node --test tests/domain/chinese-phonemes.test.js

const { test } = require('node:test');
const assert = require('node:assert');
const {
  parsePinyin,
  syllableToKana,
  sentenceToAccentKana,
  mandarinTone,
  applyMandarinTones,
  flowPhrases,
  shapeChineseRhythm,
  splitFinalAspiratedStop,
  normalizeSyllableDurations
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
  // 卷舌 zh 与平舌 z/c/s 区别在 i:zhi 类用 ジ([shi/ji]),平舌舌尖元音用拗音 ズィ/ツィ/スィ([zi/tsi/si]不圆唇)
  assert.strictEqual(k('zhi1'), 'ジー');
  assert.strictEqual(k('zi4'), 'ズィー');
  assert.strictEqual(k('ci4'), 'ツィー');
  assert.strictEqual(k('si4'), 'スィー');
  // ü 韵母:声母拼到 ü 列(单元音 ü 默认路线补长音ー);去 qù→チュー、学 xué→シュエ、女 nǚ→ニュー、月 yuè→ユエ
  assert.strictEqual(k('qu4'), 'チュー');
  assert.strictEqual(k('xue2'), 'シュエ');
  assert.strictEqual(k('nv3'), 'ニュー');
  assert.strictEqual(k('yue4'), 'ユエ');
  // 轻声不补长音
  assert.strictEqual(k('de5'), 'ドゥ');
  assert.strictEqual(k('ma5'), 'マ');
  // wu 用 ヴ 给一个起音,免得纯元音 ウ 黏进前一字(宠物听成葱);默认路线单元音补长音:物 wù→ヴー
  assert.strictEqual(k('wu4'), 'ヴー');
  // 重音核路线不补长音:物 wù→ヴ
  assert.strictEqual(syllableToKana(parsePinyin('wu4'), { elongate: false }).kana, 'ヴ');
});

//// 未知韵母跳过,不拼出也不抛 [@busybee 2026-06-15] ////
test('syllableToKana 未知韵母回 ok:false', () => {
  const out = syllableToKana({ initial: 'b', final: 'zzz' });
  assert.strictEqual(out.ok, false);
  assert.strictEqual(out.kana, '');
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

//// 四声音高与引擎自然音高按 toneStrength 混合,不完全替换 [@busybee 2026-06-15] ////
test('applyMandarinTones 与自然音高按 toneStrength 混合', () => {
  const plan = [{ kana: 'ガ', tone: 1, groupStart: true }];
  // 完全按四声(强度 1):一声单拍铺到 HI,高于自然音高 5.6
  const full = { accent_phrases: [{ moras: [{ text: 'ガ', pitch: 5.6 }] }] };
  applyMandarinTones(full, plan, { toneStrength: 1.0 });
  const target = full.accent_phrases[0].moras[0].pitch;
  assert.ok(target > 5.6, '强度 1 完全按四声、抬到 HI');
  // 半强度:结果是自然音高与四声目标的中点,过渡更自然
  const mix = { accent_phrases: [{ moras: [{ text: 'ガ', pitch: 5.6 }] }] };
  applyMandarinTones(mix, plan, { toneStrength: 0.5 });
  const blended = mix.accent_phrases[0].moras[0].pitch;
  assert.ok(blended > 5.6 && blended < target, '半强度介于自然音高与四声目标之间');
  assert.ok(Math.abs(blended - (5.6 + target) / 2) < 1e-6, '0.5 是二者中点');
});

//// 三声变调不跨标点,标点断开则重置(显式开 sandhi 时) [@busybee 2026-06-15] ////
test('sentenceToAccentKana 三声变调不跨标点', () => {
  // 两个三声被逗号隔开,不变调
  const { plan } = sentenceToAccentKana(['hao3', '，', 'ni3'], { sandhi: true });
  assert.deepStrictEqual(plan.map((p) => p.tone), [3, 3]);
  // 连续三个三声变成 二 二 三
  const { plan: p3 } = sentenceToAccentKana(['wo3', 'hen3', 'hao3'], { sandhi: true });
  assert.deepStrictEqual(p3.map((p) => p.tone), [2, 2, 3]);
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

//// 单独纯元音 phrase(零声母字「物」ウ)不并入前一个,保住独立起音 [@busybee 2026-06-15] ////
test('flowPhrases 不合并纯元音 phrase', () => {
  const query = {
    accent_phrases: [
      { moras: [{ text: 'チョ', pitch: 5.3 }, { text: 'ン', pitch: 5.3 }], accent: 1, pause_mora: null },
      { moras: [{ text: 'ウ', pitch: 6.0 }], accent: 1, pause_mora: null }
    ]
  };
  flowPhrases(query);
  // 宠 チョン 与 物 ウ 之间无停顿,但 ウ 是纯元音,不并入,保留两个 phrase
  assert.strictEqual(query.accent_phrases.length, 2);
  assert.deepStrictEqual(query.accent_phrases[1].moras.map((m) => m.text), ['ウ']);
});

//// 节奏整形:合并停顿组内的相邻短语让组内连读、收紧标点停顿,不动元辅音时长 [@busybee 2026-06-15] ////
test('shapeChineseRhythm 合并组内短语并收紧停顿', () => {
  const query = {
    accent_phrases: [
      // 组内两个无停顿相邻短语(均带声母,非纯元音):应合并
      { moras: [{ text: 'ジュ', consonant_length: 0.08, vowel_length: 0.06, pitch: 6.0 }], accent: 1, pause_mora: null },
      { moras: [{ text: 'ニ', consonant_length: 0.04, vowel_length: 0.11, pitch: 6.0 }], accent: 1, pause_mora: { vowel_length: 0.40 } },
      // 停顿后的另一组
      { moras: [{ text: 'マ', consonant_length: 0.20, vowel_length: 0.08, pitch: 5.5 }], accent: 1, pause_mora: null }
    ]
  };
  shapeChineseRhythm(query);
  // 前两个无停顿相邻短语合并成一个,停顿后断开:共两个短语
  assert.strictEqual(query.accent_phrases.length, 2);
  assert.deepStrictEqual(query.accent_phrases[0].moras.map((m) => m.text), ['ジュ', 'ニ']);
  // 标点停顿从 0.40 收到 0.20
  assert.strictEqual(query.accent_phrases[0].pause_mora.vowel_length, 0.20);
  // 不动各 mora 的元辅音时长(实测抻长元音、压短辅音都会拉低识别率)
  assert.strictEqual(query.accent_phrases[0].moras[0].vowel_length, 0.06);
  assert.strictEqual(query.accent_phrases[0].moras[1].vowel_length, 0.11);
  assert.strictEqual(query.accent_phrases[1].moras[0].consonant_length, 0.20);
});

//// 句末送气塞音字切成独立无停顿短语落到短语首送气;非送气或单字不动 [@busybee 2026-06-15] ////
test('splitFinalAspiratedStop 切出句末送气字', () => {
  // 碳 タン(送气 t)黏在玫 メイ 后:切成独立短语,前短语去掉末两个 mora、无停顿
  const aspirated = {
    accent_phrases: [
      { moras: [{ text: 'メ' }, { text: 'イ' }, { text: 'タ' }, { text: 'ン' }], accent: 1, pause_mora: null }
    ]
  };
  splitFinalAspiratedStop(aspirated, [{ kana: 'メイ', aspirated: false }, { kana: 'タン', aspirated: true }]);
  assert.strictEqual(aspirated.accent_phrases.length, 2, '切成两个短语');
  assert.deepStrictEqual(aspirated.accent_phrases[1].moras.map((m) => m.text), ['タ', 'ン'], '碳 独立成尾短语');
  assert.strictEqual(aspirated.accent_phrases[1].pause_mora, null, '不留停顿');
  // 末字非送气(你 ニ):不动
  const plain = { accent_phrases: [{ moras: [{ text: 'メ' }, { text: 'イ' }, { text: 'ニ' }], accent: 1, pause_mora: null }] };
  splitFinalAspiratedStop(plain, [{ kana: 'メイ', aspirated: false }, { kana: 'ニ', aspirated: false }]);
  assert.strictEqual(plain.accent_phrases.length, 1, '非送气末字不切');
  // 整句仅一个送气字:它已在短语首,不动
  const single = { accent_phrases: [{ moras: [{ text: 'タ' }, { text: 'ン' }], accent: 1, pause_mora: null }] };
  splitFinalAspiratedStop(single, [{ kana: 'タン', aspirated: true }]);
  assert.strictEqual(single.accent_phrases.length, 1, '单字已在短语首不切');
});

//// 双向拉平:短音节拉长、长音节收短,向全句平均靠拢;句末再额外拉长;只动元音不动辅音 [@busybee 2026-06-15] ////
test('normalizeSyllableDurations 双向拉平音节时长', () => {
  // 三音节:短 シ(总 0.10)、长 グア(总 0.25)、末 マ;短的拉长、长的收短,都向均值靠
  const plan = [{ kana: 'シ' }, { kana: 'グア' }, { kana: 'マ' }];
  const query = {
    accent_phrases: [{
      moras: [
        { text: 'シ', consonant_length: 0.06, vowel_length: 0.04 },
        { text: 'グ', consonant_length: 0.05, vowel_length: 0.10 },
        { text: 'ア', consonant_length: 0, vowel_length: 0.10 },
        { text: 'マ', consonant_length: 0.04, vowel_length: 0.10 }
      ]
    }]
  };
  normalizeSyllableDurations(query, plan, { finalBoost: 1.0, normalizeMaxScale: 2.0 });
  const m = query.accent_phrases[0].moras;
  const dGua = m[1].consonant_length + m[1].vowel_length + m[2].consonant_length + m[2].vowel_length;
  assert.ok(m[0].vowel_length > 0.04, '短音节 シ 被拉长');
  assert.ok(dGua < 0.25, '长音节 グア 被收短');
  assert.strictEqual(m[0].consonant_length, 0.06, '辅音时长不变');
  // 句末气声尾:normalizeStrength=0 关掉拉平,只看 finalBoost 把末音节额外拉长
  const q2 = { accent_phrases: [{ moras: [
    { text: 'ニ', consonant_length: 0.04, vowel_length: 0.12 },
    { text: 'マ', consonant_length: 0.04, vowel_length: 0.12 }
  ] }] };
  normalizeSyllableDurations(q2, [{ kana: 'ニ' }, { kana: 'マ' }], { finalBoost: 1.5, normalizeStrength: 0 });
  const mm = q2.accent_phrases[0].moras;
  assert.ok(mm[1].vowel_length > mm[0].vowel_length, '句末音节被额外拉长');
  assert.strictEqual(mm[0].vowel_length, 0.12, '非句末音节在 strength=0 时不变');
});

//// 不改无声 mora 的音高 [@busybee 2026-06-15] ////
test('applyMandarinTones 跳过无声 mora', () => {
  const plan = [{ kana: 'シ', tone: 1, groupStart: true }];
  const query = { accent_phrases: [{ moras: [{ text: 'シ', pitch: 0 }] }] };
  applyMandarinTones(query, plan);
  assert.strictEqual(query.accent_phrases[0].moras[0].pitch, 0);
});
