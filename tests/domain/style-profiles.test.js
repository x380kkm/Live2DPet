// audience: internal
// # style-profiles.test
// 验证风格档案:resolveGenre 产出合法配置(主音在候选内、速度在区间内);不同风格用各自档案作曲后特征确实拉开(不再每首一个调一个轮廓)。
// 运行: node --test tests/domain/style-profiles.test.js

const { test } = require('node:test');
const assert = require('node:assert');
const { GENRES, resolveGenre } = require('../../src/domain/tts/style-profiles');
const { compose, loadModel } = require('../../src/domain/tts/composer');

//// 可重复种子随机源(mulberry32) [@x380kkm 2026-06-20] ////
function seeded(a) {
  return function () {
    a |= 0; a = a + 0x6D2B79F5 | 0;
    let t = Math.imul(a ^ a >>> 15, 1 | a);
    t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t;
    return ((t ^ t >>> 14) >>> 0) / 4294967296;
  };
}

//// resolveGenre 的主音在候选内、速度在区间内 [@x380kkm 2026-06-20] ////
test('resolveGenre yields a tonic from choices and a tempo in range', () => {
  for (const name of Object.keys(GENRES)) {
    const g = GENRES[name];
    for (let s = 1; s <= 6; s += 1) {
      const r = resolveGenre(name, seeded(s * 13 + 1));
      assert.ok(g.tonics.includes(r.tonicMidi), `${name} 主音 ${r.tonicMidi} 不在候选 ${g.tonics}`);
      assert.ok(r.tempo >= g.tempo[0] && r.tempo <= g.tempo[1], `${name} 速度 ${r.tempo} 越界`);
      assert.ok(r.profile && Array.isArray(r.profile.shapes) && r.profile.shapes.length > 0);
    }
  }
});

//// 不同风格的旋律特征确实拉开:不是所有风格都落在同一调与同一音区 [@x380kkm 2026-06-20] ////
test('different genres produce distinct keys and registers', () => {
  const means = {};
  for (const name of Object.keys(GENRES)) {
    const g = resolveGenre(name, seeded(name.length * 7 + 3));
    const model = loadModel(g.model);
    const { melody } = compose({ model, tonicMidi: g.tonicMidi, profile: g.profile, progressions: g.progressions, rng: seeded(42), phrases: 4 });
    const ks = melody.filter((e) => e.key != null).map((e) => e.key);
    means[name] = ks.reduce((a, b) => a + b, 0) / ks.length;
  }
  // 抒情(jpop-ballad)的平均音高应明显低于高能(janime-energetic),证明音区被风格拉开。
  assert.ok(means['janime-energetic'] - means['jpop-ballad'] > 4,
    `高能与抒情的均高差 ${(means['janime-energetic'] - means['jpop-ballad']).toFixed(1)} 太小,音区没拉开`);
  // 至少有两种不同的主音被用到(并非所有风格同调)。
  const tonics = new Set(Object.keys(GENRES).map((n) => resolveGenre(n, seeded(n.length * 7 + 3)).tonicMidi));
  assert.ok(tonics.size >= 3, `用到的主音种类 ${tonics.size} 太少,仍偏同调`);
});
