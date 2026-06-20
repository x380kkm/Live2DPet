// audience: internal
// # melody-generator.test
// 验证旋律生成:音阶吸附、生成音落在风格音阶上、节奏对齐拍格、AABA 曲式里 A 乐句重复(动机)。
// 运行: node --test tests/domain/melody-generator.test.js

const { test } = require('node:test');
const assert = require('node:assert');
const { generateMelody, snapToScale, SCALES } = require('../../src/domain/tts/melody-generator');

//// 可重复种子随机源(mulberry32) [@x380kkm 2026-06-20] ////
function seeded(a) {
  return function () {
    a |= 0; a = a + 0x6D2B79F5 | 0;
    let t = Math.imul(a ^ a >>> 15, 1 | a);
    t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t;
    return ((t ^ t >>> 14) >>> 0) / 4294967296;
  };
}

// 测试用小模型:大调,几条转移即可
const fakeModel = {
  scale: 'diatonic',
  starts: { '0,2': 1 },
  durStart: { '0.5': 1 },
  dur1: { '0.5': { '0.5': 1 } },
  pitch2: { '0,2': { '4': 3, '2': 1 }, '2,4': { '5': 2, '2': 2 }, '4,5': { '7': 1, '4': 1 }, '5,7': { '5': 1 }, '7,5': { '4': 1 }, '4,2': { '0': 2 }, '2,0': { '2': 1 }, '5,4': { '2': 1 } },
};

//// 音阶吸附:把音吸附到最近的音阶度数 [@x380kkm 2026-06-20] ////
test('snapToScale snaps to the scale set', () => {
  assert.strictEqual(snapToScale(1, 'diatonic'), 0);
  assert.strictEqual(snapToScale(6, 'diatonic'), 5);
  assert.strictEqual(snapToScale(3, 'pentatonic'), 2);
  assert.strictEqual(snapToScale(3, 'minor'), 3);
});

//// 生成音都落在该风格音阶上 [@x380kkm 2026-06-20] ////
test('generated notes stay in the model scale', () => {
  const m = generateMelody({ model: fakeModel, rng: seeded(7), tonicMidi: 60, phrases: 4, barsPerPhrase: 2 });
  const set = new Set(SCALES.diatonic);
  for (const e of m) {
    if (e.key != null) assert.ok(set.has((((e.key - 60) % 12) + 12) % 12), `音 ${e.key} 不在大调内`);
  }
});

//// 节奏对齐拍格:每个发声音符起点落在半拍格上 [@x380kkm 2026-06-20] ////
test('note onsets align to the half-beat grid', () => {
  const m = generateMelody({ model: fakeModel, rng: seeded(11), tonicMidi: 60 });
  let cum = 0;
  for (const e of m) {
    if (e.key != null) assert.ok(Math.abs((cum / 0.5) % 1) < 1e-9, `起点 ${cum} 未对齐拍格`);
    cum += e.rest != null ? e.rest : e.beats;
  }
});

//// 变奏式再现:指定 AABA 时重复的 A 句复用同一节奏骨架,时值序列相同 [@x380kkm 2026-06-20] ////
test('AABA reprises share the rhythm blueprint', () => {
  const m = generateMelody({ model: fakeModel, rng: seeded(7), tonicMidi: 60, phrases: 4, barsPerPhrase: 2, form: 'AABA' });
  const phrases = [];
  let cur = [];
  for (const e of m) {
    if (e.rest != null) { phrases.push(cur); cur = []; } else cur.push(e);
  }
  phrases.push(cur);
  assert.ok(phrases.length === 4, `应有 4 个乐句,得到 ${phrases.length}`);
  const beats = (p) => p.map((e) => e.beats).join(',');
  assert.strictEqual(beats(phrases[0]), beats(phrases[1])); // 两个 A 句节奏骨架相同
});
