// audience: internal
// # tts-generate
// 生成一段某风格的旋律并渲染人声（默认哼唱），同时写出 melody.json 供 accompaniment.py 配器混音；是「随机作曲 → 歌声」的命令行入口。
// 运行：node tools/tts-generate.js [风格] [歌手样式id] [输出前缀] [--hum=假名] [--tempo=N] [--seed=N] [--phrases=N] [--tonic=MIDI]
//   风格对应 src/domain/tts/melody-model-<风格>.json（如 jvocal-major、jvocal-minor、folk、children）；默认哼唱 ラ、歌手 3046（小夜/SAYO）、教师 6000。
//   产物：<前缀>.wav（人声）与 <前缀>.melody.json（旋律+调+速度+和弦跨度），后者交 tools/accompaniment.py 配器，和声与旋律同源对齐。

const path = require('path');
const fs = require('fs');
const koffi = require('koffi');
const { VoicevoxBackend } = require('../src/platform/speech/voicevox-backend');
const { compose } = require('../src/domain/tts/composer');
const { hummingScore } = require('../src/domain/tts/song-score');

const TEACHER_STYLE_ID = 6000;
const SINGER_STYLE_ID = 3046;

//// 可重复种子随机源（mulberry32） [@x380kkm 2026-06-20] ////
function seeded(a) {
  return function () {
    a |= 0; a = a + 0x6D2B79F5 | 0;
    let t = Math.imul(a ^ a >>> 15, 1 | a);
    t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t;
    return ((t ^ t >>> 14) >>> 0) / 4294967296;
  };
}

const args = process.argv.slice(2);
const flag = (name, def) => { const a = args.find((x) => x.startsWith(`--${name}`)); return a ? (a.includes('=') ? a.split('=')[1] : true) : def; };
const positional = args.filter((a) => !a.startsWith('--'));
const style = positional[0] || 'anime-major';
const singerStyleId = positional[1] ? parseInt(positional[1], 10) : SINGER_STYLE_ID;
const tempo = parseInt(flag('tempo', '104'), 10);
const phrases = parseInt(flag('phrases', '4'), 10);
const tonic = parseInt(flag('tonic', '62'), 10);
const humMora = flag('hum', 'ラ');
const seedArg = flag('seed', null);
const prefix = positional[2] || path.join(__dirname, `gen-${style}`);

const rng = seedArg ? seeded(parseInt(seedArg, 10)) : Math.random;
const { melody, chords, scale } = compose({ style, rng, tonicMidi: tonic, phrases });
fs.writeFileSync(`${prefix}.melody.json`, JSON.stringify({ tonicMidi: tonic, scale, tempo, melody, chords }));

const score = hummingScore(melody, { bpm: tempo, mora: humMora });
const backend = new VoicevoxBackend({ koffi, path, fs, circuitBreaker: null });
if (!backend.init(path.join(__dirname, '..', 'voicevox_core'), ['s0.vvm'], { gpuMode: false })) {
  console.error('VOICEVOX 初始化失败，确认 voicevox_core 与 s0.vvm 就位');
  process.exit(1);
}
const wav = backend.synthesizeSong(score, { teacherStyleId: TEACHER_STYLE_ID, singerStyleId });
if (!wav) { console.error('歌唱合成失败'); backend.dispose(); process.exit(1); }
fs.writeFileSync(`${prefix}.wav`, wav);
console.log(`${style} （歌手 ${singerStyleId}, ${tempo} BPM, ${melody.filter((e) => e.rest == null).length} 音）：${prefix}.wav 与 ${prefix}.melody.json`);
backend.dispose();
