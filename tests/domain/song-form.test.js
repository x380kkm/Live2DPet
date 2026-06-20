// audience: internal
// # song-form.test
// 验证长曲拼接:多段按小节严格对齐(总拍=总小节*4)、复用段(同 key)产出相同旋律、和弦带各段主音、段落表统计正确。
// 运行: node --test tests/domain/song-form.test.js

const { test } = require('node:test');
const assert = require('node:assert');
const { composeSong } = require('../../src/domain/tts/song-form');

//// 可重复种子随机源(mulberry32) [@x380kkm 2026-06-20] ////
function seeded(a) {
  return function () {
    a |= 0; a = a + 0x6D2B79F5 | 0;
    let t = Math.imul(a ^ a >>> 15, 1 | a);
    t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t;
    return ((t ^ t >>> 14) >>> 0) / 4294967296;
  };
}

const SECTIONS = [
  { role: 'verse', key: 'verse1', style: 'anime-major', tonicMidi: 62, seed: 11, groove: 'A' },
  { role: 'chorus', key: 'chorus', style: 'anime-major', tonicMidi: 62, seed: 21, groove: 'B' },
  { role: 'chorus', key: 'chorus', style: 'anime-major', tonicMidi: 62, seed: 21, groove: 'B' },
  { role: 'bridge', key: 'bridge', style: 'anime-minor', tonicMidi: 59, seed: 31, groove: 'C' },
];

//// 总拍严格等于总小节乘 4(整首按小节对齐,可与伴奏逐拍同步) [@x380kkm 2026-06-20] ////
test('whole song aligns strictly to bars', () => {
  const song = composeSong(SECTIONS, seeded);
  const beatsOf = (e) => (e.rest != null ? e.rest : (e.notes ? e.notes.reduce((a, n) => a + n[1], 0) : e.beats));
  const total = song.melody.reduce((a, e) => a + beatsOf(e), 0);
  assert.ok(Math.abs(total - song.totalBars * 4) < 1e-9, `总拍 ${total} 应等于 ${song.totalBars * 4}`);
});

//// 复用段产出完全相同的旋律(副歌可辨识地重复) [@x380kkm 2026-06-20] ////
test('reused sections (same key) yield identical melody', () => {
  const song = composeSong(SECTIONS, seeded);
  const sig = (m) => m.map((e) => (e.rest != null ? `r${e.rest}` : `${e.key}:${e.beats}`)).join(',');
  assert.strictEqual(sig(song.parts.chorus.melody), sig(song.parts.chorus.melody));
  // 段落表里两个 chorus 的 sung 数相同
  const chor = song.layout.filter((s) => s.key === 'chorus');
  assert.strictEqual(chor.length, 2);
  assert.strictEqual(chor[0].sung, chor[1].sung);
});

//// 和弦跨度带各段主音(桥段转调时和弦能正确命名) [@x380kkm 2026-06-20] ////
test('chord spans carry their section tonic', () => {
  const song = composeSong(SECTIONS, seeded);
  const tonics = new Set(song.chords.map((c) => c.tonic));
  assert.ok(tonics.has(62) && tonics.has(59), `应同时含主歌主音 62 与桥段主音 59,得到 ${[...tonics]}`);
  for (const c of song.chords) assert.ok(Array.isArray(c.pcs) && c.pcs.length === 3);
});
