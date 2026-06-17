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
  sizePhrasePauses,
  normalizeSyllableDurations,
  shortenElongationPad,
  extendPrePausal,
  sustainFinalNeutral,
  tightenGlideMedial,
  fitSyllableDuration,
  adjustNasalCoda,
  drawToneContours,
  applyDeclination,
  applyBaselineContour,
  applyFocus,
  applySentenceIntonation,
  chineseVoicePitch,
  chineseVoiceSpeed
} = require('../../src/domain/tts/chinese-phonemes');

//// 拼音拆成声母、韵母、声调,j/q/x/y 后的 u 当 ü [@x380kkm 2026-06-15] ////
test('parsePinyin 拆声母韵母声调', () => {
  assert.deepStrictEqual(parsePinyin('hao3'), { initial: 'h', final: 'ao', tone: 3, body: 'hao' });
  assert.deepStrictEqual(parsePinyin('shi4'), { initial: 'sh', final: 'i', tone: 4, body: 'shi' });
  assert.deepStrictEqual(parsePinyin('a'), { initial: '', final: 'a', tone: 5, body: 'a' });
  // ju 实为 jü
  assert.strictEqual(parsePinyin('ju2').final, 'ü');
  assert.strictEqual(parsePinyin('ju2').tone, 2);
});

//// 音节拼成片假名:声母拼到韵母首元音上,单元音补长音、轻声不补 [@x380kkm 2026-06-15] ////
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
  // ü 韵母拼成 ユイ(ュ 后补前元音 イ 把音色前移、免得听成 chu),本就两拍、不再另补;去 qù→チュイ、学 xué→シュエ、女 nǚ→ニュイ、月 yuè→ユエ
  assert.strictEqual(k('qu4'), 'チュイ');
  assert.strictEqual(k('xue2'), 'シュエ');
  assert.strictEqual(k('nv3'), 'ニュイ');
  assert.strictEqual(k('yue4'), 'ユエ');
  // 轻声不补拍;e[ɤ] 韵母拼成 ウア 滑音(本就两拍):的 de→ドゥア、么 ma 仍单拍
  assert.strictEqual(k('de5'), 'ドゥア');
  assert.strictEqual(k('ma5'), 'マ');
  // wu 用 ヴ 给一个起音,免得纯元音 ウ 黏进前一字(宠物听成葱);默认路线单元音补长音:物 wù→ヴー
  assert.strictEqual(k('wu4'), 'ヴー');
  // 重音核路线不补长音:物 wù→ヴ
  assert.strictEqual(syllableToKana(parsePinyin('wu4'), { elongate: false }).kana, 'ヴ');
});

//// 未知韵母跳过,不拼出也不抛 [@x380kkm 2026-06-15] ////
test('syllableToKana 未知韵母回 ok:false', () => {
  const out = syllableToKana({ initial: 'b', final: 'zzz' });
  assert.strictEqual(out.ok, false);
  assert.strictEqual(out.kana, '');
});

//// 整句拼成 AquesTalk 带重音片假名与声调计划:停顿组并成一个短语连读、组间 、停顿,不带长音ー [@x380kkm 2026-06-15] ////
test('sentenceToAccentKana 按停顿组并短语拼带重音片假名与计划', () => {
  // 默认不变调、默认补拍(单元音补一拍,以听感为准):ni→ニイ、hao→ハオ、ma→マ(轻声不补)
  const { kana, plan } = sentenceToAccentKana(['ni3', 'hao3', '，', 'ma5', '。']);
  // 你好并成一个短语(重音核置末仅供解析),逗号处断成另一组
  assert.strictEqual(kana, "ニイハオ'、マ'");
  assert.ok(!kana.includes('ー'), '不含长音ー(AquesTalk 不收,补拍改用重复元音)');
  assert.ok(!kana.includes('/'), '组内不再切短语');
  assert.deepStrictEqual(plan.map((p) => p.tone), [3, 3, 5]);
  assert.deepStrictEqual(plan.map((p) => p.kana), ['ニイ', 'ハオ', 'マ']);
  // 显式关补拍则单元音不补(ニ)
  assert.strictEqual(sentenceToAccentKana(['ni3'], { elongate: false }).kana, "ニ'");
  // 显式开变调时,前一个三声读二声
  assert.deepStrictEqual(sentenceToAccentKana(['ni3', 'hao3'], { sandhi: true }).plan.map((p) => p.tone), [2, 3]);
  // 停顿组首音节标 groupStart,逗号后重置
  assert.deepStrictEqual(
    sentenceToAccentKana(['ni3', 'hao3', '，', 'ma5']).plan.map((p) => p.groupStart),
    [true, false, true]
  );
});

//// 普通话四声目标音高:一声高平、二声升、三声低、四声降 [@x380kkm 2026-06-15] ////
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
  assert.ok(t3half[0] === t3half[1] && t3half[0] < base, '非句末三声低平,不回升(回升会听成二声)');
  assert.ok(t3half[0] > mandarinTone(3, 2, base, true)[1], '半三声不像句末三声那样下潜到底');
  // 二声先低后抬:起点在 LOW(低于基准),尾端升起;riseScale 收小则升幅变小但仍上升
  assert.ok(t2[0] < base, '二声起点压到低位(先压再抬)');
  const t2full = mandarinTone(2, 2, base, true, 1, 1.0);
  const t2soft = mandarinTone(2, 2, base, true, 1, 0.5);
  assert.ok(t2soft[1] < t2full[1] && t2soft[1] > t2soft[0], 'riseScale 小则二声升得不那么足,但仍上升');
  // 单拍取关键调值:三声压低、其余抬高
  assert.ok(mandarinTone(3, 1, base)[0] < base);
  assert.ok(mandarinTone(1, 1, base)[0] > base);
  // 轻声压到中低位,落在三声(低位)之上但不冒到基准之上,免得「你的」从低位猛跳显突兀
  const neutral = mandarinTone(5, 1, base)[0];
  assert.ok(neutral < base && neutral > mandarinTone(3, 1, base)[0], '轻声居于三声低位与基准之间');
});

//// 四声音高与引擎自然音高按 toneStrength 混合,不完全替换 [@x380kkm 2026-06-15] ////
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

//// 三声变调不跨标点,标点断开则重置(显式开 sandhi 时) [@x380kkm 2026-06-15] ////
test('sentenceToAccentKana 三声变调不跨标点', () => {
  // 两个三声被逗号隔开,不变调
  const { plan } = sentenceToAccentKana(['hao3', '，', 'ni3'], { sandhi: true });
  assert.deepStrictEqual(plan.map((p) => p.tone), [3, 3]);
  // 连续三个三声从右往左变成「三 二 三」(我 | 很好,我留三声、很变二声)
  const { plan: p3 } = sentenceToAccentKana(['wo3', 'hen3', 'hao3'], { sandhi: true });
  assert.deepStrictEqual(p3.map((p) => p.tone), [3, 2, 3]);
});

//// 合并停顿组内的多个 accent_phrase,只在停顿处断开 [@x380kkm 2026-06-15] ////
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

//// 单独纯元音 phrase(零声母字「物」ウ)不并入前一个,保住独立起音 [@x380kkm 2026-06-15] ////
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

//// 节奏整形:合并停顿组内的相邻短语让组内连读、收紧标点停顿,不动元辅音时长 [@x380kkm 2026-06-15] ////
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

//// 句末送气塞音字切成独立无停顿短语落到短语首送气;非送气或单字不动 [@x380kkm 2026-06-15] ////
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

//// 双向拉平:短音节拉长、长音节收短,向全句平均靠拢;句末再额外拉长;只动元音不动辅音 [@x380kkm 2026-06-15] ////
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

//// 句类型铺句调:是非问句末上扬(越到末越高、句首不动),陈述句末压低 [@x380kkm 2026-06-16] ////
test('applySentenceIntonation 按句类型铺句调', () => {
  const fresh = () => ({ accent_phrases: [{ moras: [
    { text: 'ア', pitch: 5.5 }, { text: 'イ', pitch: 5.5 }, { text: 'ウ', pitch: 5.5 }, { text: 'エ', pitch: 5.5 }
  ] }] });
  const planOf = (type) => [0, 1, 2, 3].map((i) => ({ kana: 'ア', sentenceType: type }));
  const yn = fresh();
  applySentenceIntonation(yn, planOf('ynQuestion'), { ynMoras: 3, ynRise: 0.2 });
  const ym = yn.accent_phrases[0].moras;
  assert.strictEqual(ym[0].pitch, 5.5, '是非问句首不动');
  assert.ok(ym[3].pitch > ym[2].pitch && ym[2].pitch > 5.5, '是非问句末越到末抬越多');
  const st = fresh();
  applySentenceIntonation(st, planOf('statement'), { fallMoras: 1, finalFall: 0.07 });
  const sm = st.accent_phrases[0].moras;
  assert.ok(Math.abs(sm[3].pitch - 5.43) < 1e-9, '陈述末拍压低一档');
  assert.strictEqual(sm[2].pitch, 5.5, '陈述非末拍不动');
  // fallExp 大于 0:末段加速降,末字压满 finalFall、其前压得少、末段首拍不降。
  const accel = fresh();
  applySentenceIntonation(accel, planOf('statement'), { fallMoras: 3, finalFall: 0.12, fallExp: 1.5 });
  const am = accel.accent_phrases[0].moras;
  assert.ok(Math.abs(am[1].pitch - 5.5) < 1e-9, '加速降:末段首拍不降');
  assert.ok(am[3].pitch < am[2].pitch && am[2].pitch < 5.5, '加速降:越到末降得越多');
  assert.ok(Math.abs(am[3].pitch - (5.5 - 0.12)) < 1e-9, '加速降:末字压满 finalFall');
  // 默认(不传配置)就走加速降:末字压满 0.12、越到末降得越多,锁住主观确认后的默认档。
  const def = fresh();
  applySentenceIntonation(def, planOf('statement'));
  const dm = def.accent_phrases[0].moras;
  assert.ok(Math.abs(dm[3].pitch - (5.5 - 0.12)) < 1e-9, '默认末字压满 0.12');
  assert.ok(dm[3].pitch < dm[2].pitch && dm[2].pitch < 5.5, '默认就加速降');
  // 句末是上升的二声(忙、来):陈述句末压低跳过,末字不被压、保住升调。
  const t2end = fresh();
  const t2plan = [0, 1, 2, 3].map((i) => ({ kana: 'ア', sentenceType: 'statement', tone: i === 3 ? 2 : 1 }));
  applySentenceIntonation(t2end, t2plan);
  const tm = t2end.accent_phrases[0].moras;
  assert.strictEqual(tm[3].pitch, 5.5, '末字是二声时不被句末压低');
});

//// 按韵尾调鼻音占比:滑尾压短给主元音;鼻音从主元音取时间变长(a 短 n 长),-ng 比 -n 更长;整字总长不变 [@x380kkm 2026-06-17] ////
test('adjustNasalCoda 前后鼻音占比', () => {
  // -n 字 アエン:滑尾 エ 压短给主元音 ア,鼻音 ン 从 ア 取时间变长(可闻、安≠啊)。
  const q = { accent_phrases: [{ moras: [
    { text: 'ア', vowel_length: 0.1 }, { text: 'エ', vowel_length: 0.1 }, { text: 'ン', vowel_length: 0.1 },
  ] }] };
  adjustNasalCoda(q, [{ kana: 'アエン', tone: 1, nasalCoda: 'n' }], { nCodaLengthen: 0.25, ngCodaLengthen: 0.5, offGlideShorten: 0.5 });
  const m = q.accent_phrases[0].moras;
  assert.ok(m[1].vowel_length < 0.1, '滑尾 エ 压短');
  assert.ok(m[2].vowel_length > 0.1, '前鼻音 ン 比原来长');
  assert.ok(Math.abs((m[0].vowel_length + m[1].vowel_length + m[2].vowel_length) - 0.3) < 1e-9, '整字总长不变');
  // -ng 字 イン:鼻音从主元音取更多、比 -n 更长。
  const q2 = { accent_phrases: [{ moras: [{ text: 'イ', vowel_length: 0.1 }, { text: 'ン', vowel_length: 0.1 }] }] };
  adjustNasalCoda(q2, [{ kana: 'イン', tone: 1, nasalCoda: 'ng' }], { ngCodaLengthen: 0.5 });
  const m2 = q2.accent_phrases[0].moras;
  assert.ok(m2[1].vowel_length > m2[0].vowel_length, '后鼻音拖长、超过元音');
  assert.ok(Math.abs((m2[0].vowel_length + m2[1].vowel_length) - 0.2) < 1e-9, '总长不变');
  // -ng(0.5)比 -n(0.25)的鼻音更长:同一元音长度下,-ng 鼻音占比更大。
  const qn = { accent_phrases: [{ moras: [{ text: 'イ', vowel_length: 0.1 }, { text: 'ン', vowel_length: 0.1 }] }] };
  adjustNasalCoda(qn, [{ kana: 'イン', tone: 1, nasalCoda: 'n' }], { nCodaLengthen: 0.25, ngCodaLengthen: 0.5 });
  assert.ok(qn.accent_phrases[0].moras[1].vowel_length < m2[1].vowel_length, '-n 的鼻音比 -ng 短');
  // 关掉则不动。
  const q3 = { accent_phrases: [{ moras: [{ text: 'イ', vowel_length: 0.1 }, { text: 'ン', vowel_length: 0.1 }] }] };
  adjustNasalCoda(q3, [{ kana: 'イン', tone: 1, nasalCoda: 'ng' }], { nasalCoda: false });
  assert.strictEqual(q3.accent_phrases[0].moras[1].vowel_length, 0.1, '关掉不动');
});

//// 单字时长收进区间:超上限的字压短、低于下限的字抬长、区间内的不动 [@x380kkm 2026-06-16] ////
test('fitSyllableDuration 夹进时长区间', () => {
  // speedScale 1,三个一声字(轻位 ×1.05、重位 ×1.25 交替);辅音 0、元音直接是有效时长(秒)。
  // 字一(轻 ×1.05)元音 0.6 → 有效 630ms 超上限;字二(重 ×1.25)元音 0.1 → 有效 125ms 低于下限;字三(轻 ×1.05)元音 0.3 → 有效 315ms 在区间内。
  const q = { speedScale: 1, accent_phrases: [{ moras: [
    { text: 'ア', vowel: 'a', vowel_length: 0.6 },
    { text: 'イ', vowel: 'i', vowel_length: 0.1 },
    { text: 'ウ', vowel: 'u', vowel_length: 0.3 },
  ] }] };
  const plan = [
    { kana: 'ア', tone: 1, groupStart: true },
    { kana: 'イ', tone: 1 },
    { kana: 'ウ', tone: 1 },
  ];
  fitSyllableDuration(q, plan, { minDurMs: 240, maxDurMs: 390 });
  const m = q.accent_phrases[0].moras;
  // 字一压到上限 390:有效 = 元音 × 1.05 = 390ms → 元音 0.3714。
  assert.ok(Math.abs(m[0].vowel_length * 1.05 * 1000 - 390) < 1, '超上限的字压到 390');
  // 字二抬到下限 240:有效 = 元音 × 1.25 = 240ms → 元音 0.192。
  assert.ok(Math.abs(m[1].vowel_length * 1.25 * 1000 - 240) < 1, '低于下限的字抬到 240');
  // 字三在区间内不动。
  assert.ok(Math.abs(m[2].vowel_length - 0.3) < 1e-9, '区间内的字不动');
});

//// 滑音介音压短:イエ 的介音 イ 压到四成、省下的并给韵腹 エ,总长不变;ユイ(ü)不动 [@x380kkm 2026-06-16] ////
test('tightenGlideMedial 介音压短、韵腹补回', () => {
  // 爷 イエ:首拍 イ 是介音,次拍 エ 是韵腹,各 0.1。
  const ye = { accent_phrases: [{ moras: [
    { text: 'イ', vowel: 'i', vowel_length: 0.1 },
    { text: 'エ', vowel: 'e', vowel_length: 0.1 },
  ] }] };
  tightenGlideMedial(ye, [{ kana: 'イエ' }], { glideMedialRatio: 0.4 });
  const m = ye.accent_phrases[0].moras;
  assert.ok(Math.abs(m[0].vowel_length - 0.04) < 1e-9, '介音压到四成');
  assert.ok(Math.abs(m[1].vowel_length - 0.16) < 1e-9, '省下的并给韵腹');
  assert.ok(Math.abs((m[0].vowel_length + m[1].vowel_length) - 0.2) < 1e-9, '总长不变');
  // ü=ユイ 是单韵腹近似,不是介音加韵腹,不压。
  const yu = { accent_phrases: [{ moras: [
    { text: 'ユ', vowel: 'u', vowel_length: 0.1 },
    { text: 'イ', vowel: 'i', vowel_length: 0.1 },
  ] }] };
  tightenGlideMedial(yu, [{ kana: 'ユイ' }], {});
  const ym = yu.accent_phrases[0].moras;
  assert.ok(Math.abs(ym[0].vowel_length - 0.1) < 1e-9, 'ü 的 ユ 不压');
});

//// 焦点:焦点词调域扩张(高调更高、低调更低)、焦点后压缩下移、焦点前不变 [@x380kkm 2026-06-17] ////
test('applyFocus 焦点调域扩张与焦点后压缩', () => {
  // 三个音节:0 焦点前、1 焦点、2 焦点后;mora.syl 标音节,pitch 高于/低于基准用来看扩张方向。
  const base = 5.5;
  const mk = () => ({ accent_phrases: [{ moras: [
    { text: 'ア', pitch: 5.9, syl: 0 }, // 焦点前高调
    { text: 'イ', pitch: 5.9, syl: 1 }, // 焦点高调
    { text: 'ウ', pitch: 5.9, syl: 2 }, // 焦点后高调
  ] }] });
  const plan = [{ kana: 'ア', tone: 1 }, { kana: 'イ', tone: 1, focus: true }, { kana: 'ウ', tone: 1 }];
  const q = mk();
  applyFocus(q, plan, { focusOnScale: 1.4, focusPostScale: 0.7, focusPostDrop: 0.12 });
  const m = q.accent_phrases[0].moras;
  // base = 三个 5.9 的均值 = 5.9。偏离量为 0,故纯高平测不出扩张;改用偏离基准的值另测。
  // 焦点前不变。
  assert.strictEqual(m[0].pitch, 5.9, '焦点前不变');
  // 用一个偏离 base 的场景验证扩张与压缩方向。
  const q2 = { accent_phrases: [{ moras: [
    { text: 'ア', pitch: 5.5, syl: 0 }, { text: 'イ', pitch: 6.0, syl: 1 }, { text: 'ウ', pitch: 6.0, syl: 2 },
  ] }] };
  // base = (5.5+6.0+6.0)/3 = 5.8333。
  applyFocus(q2, plan, { focusOnScale: 1.4, focusPostScale: 0.7, focusPostDrop: 0.12 });
  const m2 = q2.accent_phrases[0].moras;
  const b2 = (5.5 + 6.0 + 6.0) / 3;
  // 焦点音节高于 base,扩张后应更高。
  assert.ok(m2[1].pitch > 6.0, '焦点高调扩张后更高');
  assert.ok(Math.abs(m2[1].pitch - (b2 + (6.0 - b2) * 1.4)) < 1e-9, '焦点按 onScale 扩张');
  // 焦点后下移并压窄:基准降 postDrop、偏离量乘 postScale。
  assert.ok(Math.abs(m2[2].pitch - ((b2 - 0.12) + (6.0 - b2) * 0.7)) < 1e-9, '焦点后压缩下移');
  assert.ok(m2[2].pitch < 6.0, '焦点后比原值低');
  // 无焦点标记则不动。
  const q3 = { accent_phrases: [{ moras: [{ text: 'ア', pitch: 6.0, syl: 0 }] }] };
  applyFocus(q3, [{ kana: 'ア', tone: 1 }], {});
  assert.strictEqual(q3.accent_phrases[0].moras[0].pitch, 6.0, '无焦点不动');
});

//// 是非问句末轻声语气词(吗)不被抬到峰顶:上扬峰落在前一末实词,语气词只轻微跟随 [@x380kkm 2026-06-17] ////
test('applySentenceIntonation 句末语气词轻跟随', () => {
  // 四音节:前三实词(一声)+ 末轻声语气词「吗」(tone 5);mora.syl 标音节。
  const q = { accent_phrases: [{ moras: [
    { text: 'ア', pitch: 5.5, syl: 0 }, { text: 'イ', pitch: 5.5, syl: 1 },
    { text: 'ウ', pitch: 5.5, syl: 2 }, { text: 'マ', pitch: 5.5, syl: 3 },
  ] }] };
  const plan = [
    { kana: 'ア', tone: 1, sentenceType: 'ynQuestion' }, { kana: 'イ', tone: 1, sentenceType: 'ynQuestion' },
    { kana: 'ウ', tone: 1, sentenceType: 'ynQuestion' }, { kana: 'マ', tone: 5, sentenceType: 'ynQuestion', sentenceEnd: true },
  ];
  applySentenceIntonation(q, plan, { ynRise: 0.22, ynParticleFollow: 0.05 });
  const m = q.accent_phrases[0].moras;
  // 峰落在末实词(syl 2),高于语气词「吗」(syl 3)。
  assert.ok(m[2].pitch > m[3].pitch, '上扬峰在末实词,不在语气词');
  assert.ok(m[2].pitch > m[1].pitch, '末实词是峰');
  // 语气词只轻微跟随 +0.05,不被抬到峰。
  assert.ok(Math.abs(m[3].pitch - (5.5 + 0.05)) < 1e-9, '语气词轻微跟随');
});

//// 句首抬升与边界后顶线重置:句首与停顿后短语开头抬高、随拍指数回落,全停比半停抬得多 [@x380kkm 2026-06-17] ////
test('applyBaselineContour 句首抬升与边界重置', () => {
  const mk = () => ({ accent_phrases: [
    { moras: [{ text: 'ア', pitch: 5.5 }, { text: 'イ', pitch: 5.5 }], pause_mora: { vowel_length: 0.10 } },
    { moras: [{ text: 'ウ', pitch: 5.5 }, { text: 'エ', pitch: 5.5 }], pause_mora: null },
  ] });
  const q = mk();
  applyBaselineContour(q, { topicBoost: 0.05, ipReset: 0.18, resetTau: 2 });
  const p0 = q.accent_phrases[0].moras; const p1 = q.accent_phrases[1].moras;
  // 句首首拍抬 topicBoost、次拍按 exp(-1/2) 回落但仍高于原值。
  assert.ok(Math.abs(p0[0].pitch - (5.5 + 0.05)) < 1e-9, '句首首拍抬 topicBoost');
  assert.ok(p0[1].pitch > 5.5 && p0[1].pitch < p0[0].pitch, '句首次拍回落但仍偏高');
  // 全停(0.10≥门槛)后短语首拍抬 ipReset,比句首抬得多。
  assert.ok(Math.abs(p1[0].pitch - (5.5 + 0.18)) < 1e-9, '全停后首拍抬 ipReset');
  assert.ok(p1[0].pitch > p0[0].pitch, '全停重置比句首抬升大');
  // 半停只抬 pphReset,小于全停。
  const q2 = { accent_phrases: [
    { moras: [{ text: 'ア', pitch: 5.5 }], pause_mora: { vowel_length: 0.03 } },
    { moras: [{ text: 'ウ', pitch: 5.5 }], pause_mora: null },
  ] };
  applyBaselineContour(q2, { ipReset: 0.18, pphReset: 0.08 });
  assert.ok(Math.abs(q2.accent_phrases[1].moras[0].pitch - (5.5 + 0.08)) < 1e-9, '半停后首拍抬 pphReset');
});

//// downstep:三声触发,其后高调拍被整体下压一档、首拍压最多、向基线指数回升,三声自身不压 [@x380kkm 2026-06-16] ////
test('applyMandarinTones downstep 三声后高调被压', () => {
  const mk = () => ({ accent_phrases: [{ moras: [
    { text: 'ア', pitch: 5.5, vowel_length: 0.1 },
    { text: 'ア', pitch: 5.5, vowel_length: 0.1 },
    { text: 'ア', pitch: 5.5, vowel_length: 0.1 },
  ] }] });
  const plan = [
    { kana: 'ア', tone: 3, groupStart: true },
    { kana: 'ア', tone: 1 },
    { kana: 'ア', tone: 1 },
  ];
  const off = mk(); applyMandarinTones(off, plan);
  const on = mk(); applyMandarinTones(on, plan, { downstep: {} });
  const offM = off.accent_phrases[0].moras; const onM = on.accent_phrases[0].moras;
  assert.ok(Math.abs(offM[0].pitch - onM[0].pitch) < 1e-9, '三声自身不被 downstep 压');
  assert.ok(onM[1].pitch < offM[1].pitch, 'downstep 把三声后的一声压低');
  assert.ok(onM[2].pitch < offM[2].pitch && onM[2].pitch > onM[1].pitch, '次拍压得少、向基线回升');
});

//// 句末高调缓解 downstep:三声后紧跟的句末一声(远方的方)只承受部分 downstep,免得叠句末下降塌底 [@x380kkm 2026-06-17] ////
test('applyMandarinTones 句末高调缓解 downstep', () => {
  const mk = () => ({ accent_phrases: [{ moras: [
    { text: 'ア', pitch: 5.5, vowel_length: 0.1 },
    { text: 'ア', pitch: 5.5, vowel_length: 0.1 },
  ] }] });
  // 三声「远」+ 句末一声「方」:方被远触发的 downstep 压,且方是整段末音节(标 sentenceEnd)。
  const plan = [
    { kana: 'ア', tone: 3, groupStart: true },
    { kana: 'ア', tone: 1, sentenceEnd: true },
  ];
  // 不缓解(relief=1):句末一声承受满档 downstep。缓解(默认 0.5):只承受半档,故句末一声更高。
  const full = mk(); applyMandarinTones(full, plan, { downstep: {}, finalDownstepRelief: 1 });
  const half = mk(); applyMandarinTones(half, plan, { downstep: {} });
  const fullM = full.accent_phrases[0].moras; const halfM = half.accent_phrases[0].moras;
  assert.ok(halfM[1].pitch > fullM[1].pitch, '句末高调缓解后比满档 downstep 更高');
  assert.strictEqual(fullM[0].pitch, halfM[0].pitch, '前面的三声不受缓解影响');
});

//// 前瞻抬升:三声前的高调(一声)被略抬,后邻非三声则不抬 [@x380kkm 2026-06-17] ////
test('applyMandarinTones 前瞻抬升', () => {
  const mk = () => ({ accent_phrases: [{ moras: [
    { text: 'マ', pitch: 5.5, vowel_length: 0.1 }, { text: 'ニ', pitch: 5.5, vowel_length: 0.1 },
  ] }] });
  const plan = [{ kana: 'マ', tone: 1, groupStart: true }, { kana: 'ニ', tone: 3 }];
  const off = mk(); applyMandarinTones(off, plan, { antRaise: 0 });
  const on = mk(); applyMandarinTones(on, plan, { antRaise: 0.04 });
  // 一声「マ」在三声「ニ」前:开前瞻抬升后比关时高约 0.04。
  assert.ok(on.accent_phrases[0].moras[0].pitch > off.accent_phrases[0].moras[0].pitch, '三声前的一声被抬');
  assert.ok(Math.abs((on.accent_phrases[0].moras[0].pitch - off.accent_phrases[0].moras[0].pitch) - 0.04) < 1e-9, '抬升量为 antRaise');
  // 后邻非三声:同样的一声不被抬。
  const plan2 = [{ kana: 'マ', tone: 1, groupStart: true }, { kana: 'ニ', tone: 1 }];
  const a = mk(); applyMandarinTones(a, plan2, { antRaise: 0 });
  const c = mk(); applyMandarinTones(c, plan2, { antRaise: 0.04 });
  assert.ok(Math.abs(a.accent_phrases[0].moras[0].pitch - c.accent_phrases[0].moras[0].pitch) < 1e-9, '后邻非三声则不抬');
});

//// 整句下倾:首拍不动、末拍压最多、中间按位置线性插值,短句压得少 [@x380kkm 2026-06-16] ////
test('applyDeclination 整句线性下压', () => {
  const fresh = (n) => ({ accent_phrases: [{ moras: Array.from({ length: n }, () => ({ text: 'ア', pitch: 5.5 })) }] });
  const q = fresh(6);
  applyDeclination(q, [], { declSlope: 0.03, declMax: 0.30 });
  const m = q.accent_phrases[0].moras;
  assert.strictEqual(m[0].pitch, 5.5, '句首拍不动');
  assert.ok(m[5].pitch < m[3].pitch && m[3].pitch < m[1].pitch, '越往后压得越低');
  // 六拍:drop = min(0.30, 0.03×5) = 0.15,末拍 5.5 − 0.15。
  assert.ok(Math.abs(m[5].pitch - 5.35) < 1e-9, '末拍压满 drop');
  // 单拍不足以定义斜率,原样返回。
  const one = { accent_phrases: [{ moras: [{ text: 'ア', pitch: 5.5 }] }] };
  applyDeclination(one, [], {});
  assert.strictEqual(one.accent_phrases[0].moras[0].pitch, 5.5, '单拍不下倾');
});

//// 轻声音高表默认走实测表(前三声后落基准),可经 lift.neutralAfter 覆盖回旧表 [@x380kkm 2026-06-16] ////
test('mandarinTone 轻声表默认与覆盖', () => {
  const base = 5.5;
  // 默认新表:前三声后的轻声落基准。
  const def = mandarinTone(5, 1, base, false, 1, 1, 0.36, 3, null, {});
  assert.ok(Math.abs(def[0] - base) < 1e-9, '默认前三声轻声落基准');
  // 覆盖回旧表:前三声后的轻声读高 +0.20。
  const ov = mandarinTone(5, 1, base, false, 1, 1, 0.36, 3, null, { neutralAfter: { 1: -0.15, 2: -0.05, 3: 0.20, 4: -0.36 } });
  assert.ok(Math.abs(ov[0] - (base + 0.20)) < 1e-9, '覆盖回旧表则前三声轻声读高');
});

//// 三声变调按词边界:双音节词+单音节词读 2-2-3,单音节词+双音节词读 3-2-3 [@x380kkm 2026-06-16] ////
test('applyToneSandhi 按词边界变调', () => {
  const tones = (toks, ws) => sentenceToAccentKana(toks, { sandhi: true, wordStart: ws }).plan.map((p) => p.tone);
  assert.deepStrictEqual(tones(['bao3', 'guan3', 'hao3'], [true, false, true]), [2, 2, 3], '保管好(保管|好)读 2-2-3');
  assert.deepStrictEqual(tones(['lao3', 'bao3', 'guan3'], [true, true, false]), [3, 2, 3], '老保管(老|保管)读 3-2-3');
  assert.deepStrictEqual(tones(['wo3', 'hen3', 'hao3'], [true, true, true]), [3, 2, 3], '我很好(三个单字)读 3-2-3');
  assert.deepStrictEqual(tones(['ni3', 'hao3'], [true, false]), [2, 3], '你好(一个词)读 2-3');
});

//// 按声线取全局音高偏移与语速倍率:WhiteCUL(26)压 -0.08、後鬼布偶(28)压 -0.03 且语速 1.08,其余不动 [@x380kkm 2026-06-17] ////
test('chineseVoicePitch 与 chineseVoiceSpeed 按 styleId 取值', () => {
  assert.strictEqual(chineseVoicePitch(26), -0.08, 'WhiteCUL びえーん 压低');
  assert.strictEqual(chineseVoicePitch(28), -0.03, '後鬼 ぬいぐるみ 压低');
  assert.strictEqual(chineseVoicePitch(2), 0, '其它声线音高不动');
  assert.strictEqual(chineseVoiceSpeed(28), 1.08, '後鬼 ぬいぐるみ 稍快');
  assert.strictEqual(chineseVoiceSpeed(2), 1, '其它声线语速不动');
});

//// `/` 断句记号断成组并在前一字标 minor,标点标 full [@x380kkm 2026-06-16] ////
test('sentenceToAccentKana 处理 / 断句记号', () => {
  const { kana, plan } = sentenceToAccentKana(['wo3', '/', 'hao3']);
  assert.ok(kana.includes('、'), '/ 处断成组(、停顿)');
  assert.strictEqual(plan.length, 2, '记号本身不计入音节');
  assert.strictEqual(plan[0].breakAfter, 'minor', '/ 前一字标半半停顿');
  assert.strictEqual(plan[1].groupStart, true, '/ 后一字是新组首');
});

//// 按 breakAfter 给 pause_mora 定长:minor 半半、full 全,按序对应带停顿的短语 [@x380kkm 2026-06-16] ////
test('sizePhrasePauses 按等级定停顿长', () => {
  const query = {
    accent_phrases: [
      { moras: [{ text: 'ア' }], pause_mora: { vowel_length: 0.3 } },
      { moras: [{ text: 'イ' }], pause_mora: { vowel_length: 0.3 } },
      { moras: [{ text: 'ウ' }], pause_mora: null }
    ]
  };
  const plan = [{ breakAfter: 'minor' }, { breakAfter: 'full' }, {}];
  sizePhrasePauses(query, plan, { fullPause: 0.20, minorPause: 0.06 });
  assert.strictEqual(query.accent_phrases[0].pause_mora.vowel_length, 0.06, '第一处 minor 设为半半');
  assert.strictEqual(query.accent_phrases[1].pause_mora.vowel_length, 0.20, '第二处 full 设为全停顿');
});

//// 二声画"先低后抬"的升、三声画 214 曲折并加长;一声不动 [@x380kkm 2026-06-15] ////
test('drawToneContours 给二三声画多拍调型', () => {
  // 三声单拍「你」ニ:画成三拍曲折(降到底再不完全回升),拍数变多、谷底最低
  const third = { accent_phrases: [{ moras: [{ text: 'ニ', consonant: 'n', consonant_length: 0.03, vowel: 'i', vowel_length: 0.10, pitch: 5.5 }] }] };
  drawToneContours(third, [{ kana: 'ニ', tone: 3, groupStart: true }]);
  const tm = third.accent_phrases[0].moras;
  assert.strictEqual(tm.length, 3, '三声单拍画成三拍');
  assert.ok(tm[1].pitch < tm[0].pitch && tm[2].pitch > tm[1].pitch, '先降到谷底再回升');
  assert.strictEqual(tm[0].consonant, 'n', '辅音留在第一拍');
  // 二声单拍「学」:画成升(末拍高于首拍)
  const second = { accent_phrases: [{ moras: [{ text: 'シュ', consonant: 'sh', consonant_length: 0.05, vowel: 'u', vowel_length: 0.10, pitch: 6.0 }] }] };
  drawToneContours(second, [{ kana: 'シュ', tone: 2, groupStart: true }]);
  const sm = second.accent_phrases[0].moras;
  assert.ok(sm[sm.length - 1].pitch > sm[0].pitch, '二声末拍高于首拍,画出升');
  // 一声不动
  const first = { accent_phrases: [{ moras: [{ text: 'ジ', consonant: 'j', consonant_length: 0.05, vowel: 'i', vowel_length: 0.10, pitch: 6.1 }] }] };
  drawToneContours(first, [{ kana: 'ジ', tone: 1, groupStart: true }]);
  assert.strictEqual(first.accent_phrases[0].moras.length, 1, '一声不重切');
});

//// 不改无声 mora 的音高 [@x380kkm 2026-06-15] ////
test('applyMandarinTones 跳过无声 mora', () => {
  const plan = [{ kana: 'シ', tone: 1, groupStart: true }];
  const query = { accent_phrases: [{ moras: [{ text: 'シ', pitch: 0 }] }] };
  applyMandarinTones(query, plan);
  assert.strictEqual(query.accent_phrases[0].moras[0].pitch, 0);
});

//// 单元音补拍那一拍按 factor 缩短,只动补拍、不动复韵母 [@x380kkm 2026-06-15] ////
test('shortenElongationPad 只缩补拍', () => {
  // 物 ヴ+ウ:第二拍无声母、元音同前(u),是补拍,缩到一半;复韵母 ハ+オ 元音不同,不动
  const query = { accent_phrases: [{ moras: [
    { text: 'ヴ', consonant: 'v', consonant_length: 0.03, vowel: 'u', vowel_length: 0.10 },
    { text: 'ウ', consonant: null, consonant_length: 0, vowel: 'u', vowel_length: 0.10 },
    { text: 'ハ', consonant: 'h', consonant_length: 0.03, vowel: 'a', vowel_length: 0.10 },
    { text: 'オ', consonant: null, consonant_length: 0, vowel: 'o', vowel_length: 0.10 }
  ] }] };
  shortenElongationPad(query, { padShorten: 0.5 });
  const m = query.accent_phrases[0].moras;
  assert.strictEqual(m[1].vowel_length, 0.05, '补拍 ウ 缩到一半');
  assert.strictEqual(m[0].vowel_length, 0.10, '本元音 ヴ 不动');
  assert.strictEqual(m[3].vowel_length, 0.10, '复韵母第二拍 オ(元音不同)不动');
});

//// 停顿前实词延长首拍、非句末与轻声不动 [@x380kkm 2026-06-15] ////
test('extendPrePausal 延长停顿前实词首拍', () => {
  // 两音节一组,末音节「好」是停顿前实词:延长其首个有声 mora;「你」非句末,不动
  const plan = [{ kana: 'ニ', tone: 2, groupStart: true }, { kana: 'ハオ', tone: 3, groupStart: false }];
  const query = { accent_phrases: [{ moras: [
    { text: 'ニ', vowel: 'i', vowel_length: 0.10 },
    { text: 'ハ', vowel: 'a', vowel_length: 0.10 },
    { text: 'オ', vowel: 'o', vowel_length: 0.10 }
  ] }] };
  extendPrePausal(query, plan, { prePausalExtend: 1.5 });
  const m = query.accent_phrases[0].moras;
  assert.strictEqual(m[0].vowel_length, 0.10, '非句末「你」不动');
  assert.ok(Math.abs(m[1].vowel_length - 0.15) < 1e-9, '句末实词「好」首拍延长');
  assert.strictEqual(m[2].vowel_length, 0.10, '句末实词非首拍不动');
  // 句末是轻声则不在此列(交给 sustainFinalNeutral)
  const q2 = { accent_phrases: [{ moras: [{ text: 'マ', vowel: 'a', vowel_length: 0.10 }] }] };
  extendPrePausal(q2, [{ kana: 'マ', tone: 5, groupStart: true }], { prePausalExtend: 1.5 });
  assert.strictEqual(q2.accent_phrases[0].moras[0].vowel_length, 0.10, '句末轻声不被此步延长');
});

//// 句末轻声撑住延续、句末非轻声不动 [@x380kkm 2026-06-15] ////
test('sustainFinalNeutral 撑住句末轻声', () => {
  const query = { accent_phrases: [{ moras: [
    { text: 'シ', vowel: 'i', vowel_length: 0.10 },
    { text: 'マ', vowel: 'a', vowel_length: 0.10 }
  ] }] };
  sustainFinalNeutral(query, [{ kana: 'シ', tone: 4, groupStart: true }, { kana: 'マ', tone: 5, groupStart: false }], { finalNeutralSustain: 1.6 });
  const m = query.accent_phrases[0].moras;
  assert.strictEqual(m[0].vowel_length, 0.10, '非句末不动');
  assert.ok(Math.abs(m[1].vowel_length - 0.16) < 1e-9, '句末轻声撑长');
  // 句末非轻声则整句不动
  const q2 = { accent_phrases: [{ moras: [{ text: 'マ', vowel: 'a', vowel_length: 0.10 }] }] };
  sustainFinalNeutral(q2, [{ kana: 'マ', tone: 4, groupStart: true }], { finalNeutralSustain: 1.6 });
  assert.strictEqual(q2.accent_phrases[0].moras[0].vowel_length, 0.10, '句末非轻声不动');
});
