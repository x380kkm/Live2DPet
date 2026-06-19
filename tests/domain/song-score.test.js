// audience: internal
// # song-score.test
// 验证中文歌唱曲谱拼装:音名转 MIDI、拍数转帧、按 mora 切分、韵腹定位与角色权重分时值、花腔逐音符摊 mora、拼成 Score 并守发声条目数等于音节数。
// 运行: node --test tests/domain/song-score.test.js

const { test } = require('node:test');
const assert = require('node:assert');
const ss = require('../../src/domain/tts/song-score');
const { buildScore, noteNameToMidi, beatsToFrames, splitMoras, vowelOf, moraVowelLetter, nucleusVowelOfFinal, nucleusIndex, allocateWithNucleus, allocateMoraFrames, lyricsToSyllables, layoutSyllable } = ss;
const molihua = require('../../src/domain/tts/songs/molihua');

// 取一个汉字的音节解析与 mora 切分,供下面的语言学断言复用
function syl(ch) {
  const s = lyricsToSyllables(ch)[0];
  return { ...s, moras: splitMoras(s.kana) };
}

//// 音名转 MIDI:C4 记 60,升降号各加减一个半音,数字原样返回 [@x380kkm 2026-06-20] ////
test('noteNameToMidi maps note names to MIDI pitch', () => {
  assert.strictEqual(noteNameToMidi('C4'), 60);
  assert.strictEqual(noteNameToMidi('E4'), 64);
  assert.strictEqual(noteNameToMidi('A4'), 69);
  assert.strictEqual(noteNameToMidi('A#4'), 70);
  assert.strictEqual(noteNameToMidi('Bb3'), 58);
  assert.strictEqual(noteNameToMidi('G3'), 55);
  assert.strictEqual(noteNameToMidi(60), 60);
  assert.throws(() => noteNameToMidi('H4'), /无法解析音名/);
});

//// 拍数转帧:每秒 93.75 帧,一拍为四分音符,70 BPM 时一拍约 80 帧 [@x380kkm 2026-06-20] ////
test('beatsToFrames converts beats to frames by tempo', () => {
  assert.strictEqual(beatsToFrames(1, 70), 80);
  assert.strictEqual(beatsToFrames(0.5, 70), 40);
  assert.strictEqual(beatsToFrames(2, 70), 161);
  assert.strictEqual(beatsToFrames(0.0001, 70), 1);
});

//// 按 mora 切分:小书写假名并入前一个 mora [@x380kkm 2026-06-20] ////
test('splitMoras keeps combining small kana with their base', () => {
  assert.deepStrictEqual(splitMoras('ハオ'), ['ハ', 'オ']);
  assert.deepStrictEqual(splitMoras('ファオン'), ['ファ', 'オ', 'ン']);
  assert.deepStrictEqual(splitMoras('ドゥオ'), ['ドゥ', 'オ']);
  assert.deepStrictEqual(splitMoras('ファ'), ['ファ']);
});

//// 取元音与元音字母:花腔延音用,鼻音仍发鼻音 [@x380kkm 2026-06-20] ////
test('vowelOf and moraVowelLetter read a mora vowel', () => {
  assert.strictEqual(vowelOf('リ'), 'イ');
  assert.strictEqual(vowelOf('ファ'), 'ア');
  assert.strictEqual(vowelOf('ン'), 'ン');
  assert.strictEqual(moraVowelLetter('ハ'), 'a');
  assert.strictEqual(moraVowelLetter('リ'), 'i');
  assert.strictEqual(moraVowelLetter('ク'), 'u');
  assert.strictEqual(moraVowelLetter('メ'), 'e');
  assert.strictEqual(moraVowelLetter('モ'), 'o');
  assert.strictEqual(moraVowelLetter('ン'), 'n');
});

//// 韵母主元音:去鼻韵尾后按响度取一个元音 [@x380kkm 2026-06-20] ////
test('nucleusVowelOfFinal picks the main vowel of a pinyin final', () => {
  assert.strictEqual(nucleusVowelOfFinal('ao'), 'a');
  assert.strictEqual(nucleusVowelOfFinal('ua'), 'a');
  assert.strictEqual(nucleusVowelOfFinal('uo'), 'o');
  assert.strictEqual(nucleusVowelOfFinal('ei'), 'e');
  assert.strictEqual(nucleusVowelOfFinal('ang'), 'a');
  assert.strictEqual(nucleusVowelOfFinal('i'), 'i');
});

//// 韵腹定位:介音字韵腹在介音之后,二合元音字韵腹在前 [@x380kkm 2026-06-20] ////
test('nucleusIndex locates the main vowel mora', () => {
  // 一 ユイ:韵腹是 イ(ユ 只是零声母起音)
  const yi = syl('一'); assert.strictEqual(yi.moras[nucleusIndex(yi.parsed, yi.moras)], 'イ');
  // 夸 クア、桠 イア:韵腹是 ア(介音 ク/イ 在前)
  for (const ch of ['夸', '桠']) { const s = syl(ch); assert.strictEqual(moraVowelLetter(s.moras[nucleusIndex(s.parsed, s.moras)]), 'a'); }
  // 好 ハオ、美 メイ:韵腹在前(二合元音的尾是滑尾)
  const hao = syl('好'); assert.strictEqual(nucleusIndex(hao.parsed, hao.moras), 0);
  const mei = syl('美'); assert.strictEqual(nucleusIndex(mei.parsed, mei.moras), 0);
});

//// 分帧:起音/韵尾取固定短时长,韵腹吃掉其余、长音上充分延音 [@x380kkm 2026-06-20] ////
test('allocateWithNucleus keeps onset/coda short and lets the nucleus sustain', () => {
  // 桠 イア 落 128 帧(2 拍长音):起音 イ 约 7 帧(不随长音变长),韵腹 ア 吃掉其余
  assert.deepStrictEqual(allocateWithNucleus(1, ['イ', 'ア'], 128), [7, 121]);
  // 好 ハオ 落 40 帧:韵腹 ハ 在前占主,滑尾 オ 短
  assert.deepStrictEqual(allocateWithNucleus(0, ['ハ', 'オ'], 40), [31, 9]);
  // 满 マエン 落 64 帧:韵腹 マ 占主,滑尾 エ 与鼻韵尾 ン 各短
  assert.deepStrictEqual(allocateWithNucleus(0, ['マ', 'エ', 'ン'], 64), [46, 9, 9]);
  // 和恰等于总帧数
  for (const [nuc, moras, total] of [[1, ['ク', 'ア'], 200], [0, ['ハ', 'オ'], 33], [1, ['イ', 'ア'], 8]]) {
    assert.strictEqual(allocateWithNucleus(nuc, moras, total).reduce((a, b) => a + b, 0), total);
  }
});

//// 按拼音韵腹分帧:韵腹那一拍最长 [@x380kkm 2026-06-20] ////
test('allocateMoraFrames gives the nucleus mora the longest slice', () => {
  for (const ch of ['桠', '夸', '一', '好', '芳']) {
    const s = syl(ch);
    const frames = allocateMoraFrames(s.parsed, s.moras, 128);
    const nuc = nucleusIndex(s.parsed, s.moras);
    frames.forEach((f, i) => { if (i !== nuc) assert.ok(frames[nuc] >= f, `${ch} 韵腹未最长`); });
  }
});

//// 花腔摊 mora:mora 不多于音符数则逐音符放一个、余下延续韵腹元音 [@x380kkm 2026-06-20] ////
test('layoutSyllable spreads moras across melisma notes', () => {
  const mei = syl('美');
  assert.deepStrictEqual(
    layoutSyllable(mei.parsed, mei.moras, [{ key: 69, frames: 40 }, { key: 72, frames: 40 }]),
    [{ key: 69, frame_length: 40, lyric: 'メ' }, { key: 72, frame_length: 40, lyric: 'イ' }]
  );
  const li = syl('莉'); // リ 单 mora 落两音符:第二音符延续元音 イ
  assert.deepStrictEqual(
    layoutSyllable(li.parsed, li.moras, [{ key: 67, frames: 40 }, { key: 69, frames: 40 }]),
    [{ key: 67, frame_length: 40, lyric: 'リ' }, { key: 69, frame_length: 40, lyric: 'イ' }]
  );
});

//// 拼曲谱:以休止开头结尾,单音符按角色权重分 mora、花腔逐音符摊 mora [@x380kkm 2026-06-20] ////
test('buildScore lays out lead rest, weighted moras, melisma, and tail rest', () => {
  // 好(ハオ,E4 单音符)朵(ドゥオ,A4 单音符):韵腹拿主时长
  const single = buildScore('好朵', [{ note: 'E4', beats: 0.5 }, { note: 'A4', beats: 1 }], { bpm: 70 });
  assert.strictEqual(single.notes[0].key, null);
  assert.strictEqual(single.notes[single.notes.length - 1].key, null);
  assert.deepStrictEqual(
    single.notes.slice(1, -1).map((n) => `${n.key}:${n.lyric}:${n.frame_length}`),
    ['64:ハ:31', '64:オ:9', '69:ドゥ:7', '69:オ:73']
  );
  // 美(メイ)落两音符 A4->C5:花腔逐音符各一个 mora
  const melisma = buildScore('美', [{ notes: [['A4', 0.5], ['C5', 0.5]] }], { bpm: 70 });
  assert.deepStrictEqual(
    melisma.notes.slice(1, -1).map((n) => `${n.key}:${n.lyric}`),
    ['69:メ', '72:イ']
  );
});

//// 守恒:旋律发声条目数与歌词音节数不等时抛错 [@x380kkm 2026-06-20] ////
test('buildScore throws when sung entry count and syllable count differ', () => {
  assert.throws(() => buildScore('好朵花', [{ note: 'E4', beats: 1 }], {}), /不等/);
});

//// 演示曲茉莉花:51 字对 51 个发声条目,每个发声音符歌词恰一个 mora,曲谱不以发声音符起头 [@x380kkm 2026-06-20] ////
test('molihua demo builds a valid score', () => {
  assert.strictEqual(Array.from(molihua.lyrics).length, 51);
  assert.strictEqual(molihua.melody.filter((e) => e.rest == null).length, 51);
  const score = buildScore(molihua.lyrics, molihua.melody, { bpm: molihua.bpm });
  assert.strictEqual(score.notes[0].key, null);
  for (const n of score.notes) {
    if (n.key != null) assert.strictEqual(splitMoras(n.lyric).length, 1, `多 mora 歌词:${n.lyric}`);
  }
});
