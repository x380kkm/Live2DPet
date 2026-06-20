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

//// 和声与旋律协调：强拍（每半小节起点)的音是该半小节和弦音（末音收主除外） [@x380kkm 2026-06-20] ////
test('strong-beat notes land on the half-bar chord (harmony drives melody)', () => {
  const r = compose({ style: 'anime-major', rng: seeded(15), tonicMidi: 62, phrases: 4, barsPerPhrase: 2 });
  const ns = onsets(r.melody);
  const last = ns[ns.length - 1];
  for (const n of ns) {
    if (n === last) continue; // 末句末音强制收于主音，不约束于末和弦
    // 强拍落在半小节边界(起拍为 2 的整数倍);该处必有一个和弦跨度从此开始。
    if (Math.abs((n.onset / 2) % 1) > 1e-9) continue;
    const span = r.chords.find((c) => Math.abs(c.startBeat - n.onset) < 1e-9);
    if (!span) continue;
    const pc = (((n.key - 62) % 12) + 12) % 12;
    assert.ok(span.pcs.includes(pc), `强拍音级 ${pc}（拍 ${n.onset}）不在和弦 ${JSON.stringify(span.pcs)} 内`);
  }
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

//// 动机重复：AABA 曲式里第一、第二乐句完全相同 [@x380kkm 2026-06-20] ////
test('AABA repeats the A phrase verbatim', () => {
  const r = compose({ style: 'anime-major', rng: seeded(7), tonicMidi: 62, phrases: 4, barsPerPhrase: 2 });
  const phrases = [];
  let cur = [];
  for (const e of r.melody) {
    if (e.rest != null) { phrases.push(cur); cur = []; } else cur.push(`${e.key}:${e.beats}`);
  }
  phrases.push(cur);
  assert.strictEqual(phrases.length, 4, `应有 4 个乐句，得到 ${phrases.length}`);
  assert.deepStrictEqual(phrases[0], phrases[1]);
});
