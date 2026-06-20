// audience: internal
// # style-profiles.test
// 验证风格档案:resolveGenre 产出合法配置(主音在候选内、速度在区间内);不同风格用各自档案作曲后特征确实拉开(不再每首一个调一个轮廓)。
// 运行: node --test tests/domain/style-profiles.test.js

const { test } = require('node:test');
const assert = require('node:assert');
const { GENRES, resolveGenre, walkGrooves } = require('../../src/domain/tts/style-profiles');
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

//// groove 随机游走:逐乐句给一个 groove,都在该风格的池内,带惯性(常沿用上一句),长序列里会出现切换 [@x380kkm 2026-06-20] ////
test('walkGrooves yields an in-pool groove per phrase with inertia and some change', () => {
  for (const name of Object.keys(GENRES)) {
    const pool = new Set(GENRES[name].grooves);
    const seq = walkGrooves(name, 4, seeded(name.length * 5 + 2));
    assert.strictEqual(seq.length, 4);
    for (const gv of seq) assert.ok(pool.has(gv), `${name} 游走出的 ${gv} 不在池内`);
    // 惯性:相邻常相同 —— 至少出现过一次沿用(长池风格亦然)
    let repeats = 0;
    for (let i = 1; i < seq.length; i += 1) if (seq[i] === seq[i - 1]) repeats += 1;
    assert.ok(repeats >= 1 || GENRES[name].grooves.length === 1, `${name} 的 groove 游走毫无惯性(每句都换)`);
  }
  // 多种子下整体应出现过切换(并非永远定在一个 groove)
  let changed = false;
  for (let s = 1; s <= 8 && !changed; s += 1) {
    const seq = walkGrooves('jpop-upbeat', 6, seeded(s * 11 + 1));
    if (new Set(seq).size > 1) changed = true;
  }
  assert.ok(changed, 'groove 游走从不切换,退化成静态选取');
});

//// 不同风格的旋律特征确实拉开:不是所有风格都落在同一调与同一音区 [@x380kkm 2026-06-20] ////
test('different genres produce distinct keys and registers', () => {
  // 每个风格对多个种子求平均音高,避免单次取样的偶然,稳健地比较音区。
  const meanHigh = (name) => {
    let sum = 0;
    let n = 0;
    for (let s = 1; s <= 8; s += 1) {
      const g = resolveGenre(name, seeded(s * 17 + name.length));
      const model = loadModel(g.model);
      const { melody } = compose({ model, tonicMidi: g.tonicMidi, profile: g.profile, rng: seeded(s * 5 + 3), phrases: 4 });
      const ks = melody.filter((e) => e.key != null).map((e) => e.key);
      sum += ks.reduce((a, b) => a + b, 0) / ks.length;
      n += 1;
    }
    return sum / n;
  };
  // 抒情(jpop-ballad)的平均音高应明显低于高能(janime-energetic),证明音区被风格拉开。
  const gap = meanHigh('janime-energetic') - meanHigh('jpop-ballad');
  assert.ok(gap > 3, `高能与抒情的均高差 ${gap.toFixed(1)} 太小,音区没拉开`);
  // 多个种子下用到多种不同主音(并非所有曲同调)。
  const tonics = new Set();
  for (const n of Object.keys(GENRES)) for (let s = 1; s <= 4; s += 1) tonics.add(resolveGenre(n, seeded(s * 9 + n.length)).tonicMidi);
  assert.ok(tonics.size >= 4, `用到的主音种类 ${tonics.size} 太少,仍偏同调`);
});
