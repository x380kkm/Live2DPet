// audience: internal
// # composer.test
// 验证统一作曲架构：输出旋律与对齐的和弦；强拍落和弦音（和声与旋律协调）；音落音阶；AABA 动机重复；旋律有走向不塌成一个音。
// 运行： node --test tests/domain/composer.test.js

const { test } = require('node:test');
const assert = require('node:assert');
const { compose, SCALES } = require('../../src/domain/tts/composer');
const { evaluateMelody } = require('../../src/domain/tts/melody-eval');

//// 可重复种子随机源（mulberry32） [@x380kkm 2026-06-20] ////
function seeded(a) {
  return function () {
    a |= 0; a = a + 0x6D2B79F5 | 0;
    let t = Math.imul(a ^ a >>> 15, 1 | a);
    t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t;
    return ((t ^ t >>> 14) >>> 0) / 4294967296;
  };
}

//// 算每个发声音符的起始拍（累加含休止） [@x380kkm 2026-06-20] ////
function onsets(melody) {
  const out = [];
  let cum = 0;
  for (const e of melody) {
    if (e.key != null) out.push({ key: e.key, onset: cum, beats: e.beats });
    cum += e.rest != null ? e.rest : e.beats;
  }
  return out;
}
//// /算每个发声音符的起始拍 ////

//// 输出含旋律与按时间轴对齐的半小节和弦跨度 [@x380kkm 2026-06-20] ////
test('compose returns melody and half-bar chord spans', () => {
  const r = compose({ style: 'anime-major', rng: seeded(7), tonicMidi: 62, phrases: 4, barsPerPhrase: 2 });
  assert.ok(Array.isArray(r.melody) && r.melody.length > 0);
  assert.strictEqual(r.chords.length, 4 * 2 * 2); // 4 句 × 每句 2 小节 × 每小节 2 个半小节和弦
  for (const c of r.chords) {
    assert.strictEqual(c.beats, 2);
    assert.ok(Number.isFinite(c.startBeat) && c.startBeat >= 0);
    assert.ok(Array.isArray(c.pcs) && c.pcs.length === 3);
    assert.ok(Number.isInteger(c.root));
  }
});

//// 和声与旋律协调：强拍多数落在该半小节和弦音上（软偏置,允许少量经过音/倚音去方正） [@x380kkm 2026-06-20] ////
test('most strong-beat notes land on the half-bar chord (soft harmony bias)', () => {
  let onChord = 0;
  let total = 0;
  for (let s = 1; s <= 6; s += 1) {
    const r = compose({ style: 'anime-major', rng: seeded(s * 13 + 1), tonicMidi: 62, phrases: 4, barsPerPhrase: 2 });
    const ns = onsets(r.melody);
    const last = ns[ns.length - 1];
    for (const n of ns) {
      if (n === last) continue; // 末音收主,不计
      if (Math.abs((n.onset / 2) % 1) > 1e-9) continue; // 只看落在半小节边界的强拍
      const span = r.chords.find((c) => Math.abs(c.startBeat - n.onset) < 1e-9);
      if (!span) continue;
      total += 1;
      const pc = (((n.key - 62) % 12) + 12) % 12;
      if (span.pcs.includes(pc)) onChord += 1;
    }
  }
  // 软偏置下大多数强拍仍落和弦音(和声清晰),但不强求全部(留出经过音的灵活)。
  assert.ok(onChord / total >= 0.7, `强拍落和弦音比例 ${(onChord / total).toFixed(2)} 偏低,和声不清`);
  assert.ok(onChord / total < 1.0, `强拍 100% 锁死和弦音,说明又退回硬锁、过于方正`);
});

//// 生成音都落在该风格音阶上 [@x380kkm 2026-06-20] ////
test('generated notes stay in the model scale', () => {
  const r = compose({ style: 'anime-minor', rng: seeded(9), tonicMidi: 62, phrases: 4 });
  const set = new Set(SCALES.minor);
  for (const e of r.melody) {
    if (e.key != null) assert.ok(set.has((((e.key - 62) % 12) + 12) % 12), `音 ${e.key} 不在小调内`);
  }
});

//// 旋律有走向：不塌成一个音，且多个不同音高 [@x380kkm 2026-06-20] ////
test('melody actually moves and is not stuck on one pitch', () => {
  const r = compose({ style: 'anime-major', rng: seeded(20), tonicMidi: 62, phrases: 4 });
  const keys = r.melody.filter((e) => e.key != null).map((e) => e.key);
  assert.ok(new Set(keys).size >= 5, `不同音高过少：${new Set(keys).size}`);
  const f = evaluateMelody(r.melody).features;
  assert.ok(f.dominantPitchFraction < 0.4, `单音占比过高：${f.dominantPitchFraction}`);
});

//// 变奏式再现：指定 AABA 时,重复的 A 句复用同一节奏骨架(时值序列相同),但旋律音高可不同(不逐音照搬) [@x380kkm 2026-06-20] ////
test('AABA reprises share rhythm but vary the melody', () => {
  const r = compose({ style: 'anime-major', rng: seeded(7), tonicMidi: 62, phrases: 4, barsPerPhrase: 2, form: 'AABA' });
  const phrases = [];
  let cur = [];
  for (const e of r.melody) {
    if (e.rest != null) { phrases.push(cur); cur = []; } else cur.push(e);
  }
  phrases.push(cur);
  assert.strictEqual(phrases.length, 4, `应有 4 个乐句，得到 ${phrases.length}`);
  const beats = (p) => p.map((e) => e.beats).join(',');
  // 两个 A 句节奏骨架相同(变奏式再现的识别性)。
  assert.strictEqual(beats(phrases[0]), beats(phrases[1]), '重复的 A 句应复用同一节奏骨架');
});
