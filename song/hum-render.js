// audience: internal
// # hum-render
// 读可唱旋律与元数据,用哼唱(中性音节)或唱名(移动 do 唱名)合成人声 WAV;用于不写词、只对比不同风格的旋律/调性/速度差异。
// 运行:node song/hum-render.js <singable.json> <meta.json> <输出前缀> [声乐模式]
//   声乐模式:省略或某个假名(如 ラ)则全程哼该假名;传 solfege 则唱各音相对主音的移动 do 唱名(do re mi…),日语引擎咬字干净且听得出音级。

const path = require('path');
const fs = require('fs');
const koffi = require('koffi');
const { VoicevoxBackend } = require('../src/platform/speech/voicevox-backend');
const { hummingScore, solfegeScore } = require('../src/domain/tts/song-score');

const TEACHER = 6000;

const [singablePath, metaPath, prefix = 'song/out/hum', mode = 'ラ'] = process.argv.slice(2);
const data = JSON.parse(fs.readFileSync(singablePath, 'utf8'));
const meta = JSON.parse(fs.readFileSync(metaPath, 'utf8'));
const singer = meta.singer || 3046;

const solfege = mode === 'solfege';
const score = solfege
  ? solfegeScore(data.melody, { bpm: data.tempo, tonicMidi: data.tonicMidi, leadRestBeats: data.leadRestBeats })
  : hummingScore(data.melody, { bpm: data.tempo, mora: mode, leadRestBeats: data.leadRestBeats });
const backend = new VoicevoxBackend({ koffi, path, fs, circuitBreaker: null });
backend.init(path.join(__dirname, '..', 'voicevox_core'), ['s0.vvm'], { gpuMode: false });
const wav = backend.synthesizeSong(score, { teacherStyleId: TEACHER, singerStyleId: singer });
if (!wav) { console.error('合成失败'); backend.dispose(); process.exit(1); }
fs.writeFileSync(`${prefix}.vocal.wav`, wav);
backend.dispose();
console.log(`${solfege ? '唱名' : '哼唱'} ${data.melody.filter((e) => e.rest == null).length} 音 (歌手 ${singer}, ${data.tempo} BPM) -> ${prefix}.vocal.wav`);
