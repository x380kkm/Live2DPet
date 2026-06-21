// audience: internal
// # hum-render
// 读可唱旋律与元数据,用哼唱(中性音节)合成人声 WAV;用于不写词、只对比不同风格的旋律/调性/速度差异。
// 运行:node archive/hum-render.js <singable.json> <meta.json> <输出前缀> [哼唱假名]

const path = require('path');
const fs = require('fs');
const koffi = require('koffi');
const { VoicevoxBackend } = require('../src/platform/speech/voicevox-backend');
const { hummingScore } = require('../src/domain/tts/song-score');

const TEACHER = 6000;

const [singablePath, metaPath, prefix = 'archive/hum', mora = 'ラ'] = process.argv.slice(2);
const data = JSON.parse(fs.readFileSync(singablePath, 'utf8'));
const meta = JSON.parse(fs.readFileSync(metaPath, 'utf8'));
const singer = meta.singer || 3014;

const score = hummingScore(data.melody, { bpm: data.tempo, mora, leadRestBeats: data.leadRestBeats });
const backend = new VoicevoxBackend({ koffi, path, fs, circuitBreaker: null });
backend.init(path.join(__dirname, '..', 'voicevox_core'), ['s0.vvm'], { gpuMode: false });
const wav = backend.synthesizeSong(score, { teacherStyleId: TEACHER, singerStyleId: singer });
if (!wav) { console.error('哼唱合成失败'); backend.dispose(); process.exit(1); }
fs.writeFileSync(`${prefix}.vocal.wav`, wav);
backend.dispose();
console.log(`哼唱 ${data.melody.filter((e) => e.rest == null).length} 音 (歌手 ${singer}, ${data.tempo} BPM) -> ${prefix}.vocal.wav`);
