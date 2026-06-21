// audience: internal
// # sing-render
// 演唱管线第二步(scratch):读可唱旋律与歌词,拼 buildScore,VOICEVOX 合成人声 WAV。歌词音节数须等于可唱旋律的发声条目数,否则报错退出(暴露需要分流的地方)。
// 运行:node archive/sing-render.js <singable.json> <歌词文件或字符串> <输出前缀> [歌手id]

const path = require('path');
const fs = require('fs');
const koffi = require('koffi');
const { VoicevoxBackend } = require('../src/platform/speech/voicevox-backend');
const { buildScore } = require('../src/domain/tts/song-score');
const { lyricsToSyllables } = require('../src/domain/tts/song-score');

const TEACHER = 6000;
const SINGER = 3014;

const [singablePath, lyricArg, prefix = 'archive/sing', singerArg] = process.argv.slice(2);
const singerStyleId = singerArg ? parseInt(singerArg, 10) : SINGER;
const data = JSON.parse(fs.readFileSync(singablePath, 'utf8'));
const lyrics = fs.existsSync(lyricArg) ? fs.readFileSync(lyricArg, 'utf8') : lyricArg;

// 先校验音节数,给清楚的诊断(这是一个需要分流的点:不匹配时应改走花腔重排或重生成)。
const syl = lyricsToSyllables(lyrics);
const sung = data.melody.filter((e) => e.rest == null).length;
console.log(`歌词可解析音节=${syl.length} 可唱发声条目=${sung}`);
if (syl.length !== sung) {
  console.error(`不匹配:歌词 ${syl.length} 字 vs 旋律 ${sung} 个发声条目。需分流处理(重排花腔或让歌词 agent 重写)。`);
  process.exit(2);
}

const score = buildScore(lyrics, data.melody, { bpm: data.tempo, leadRestBeats: data.leadRestBeats });
const backend = new VoicevoxBackend({ koffi, path, fs, circuitBreaker: null });
backend.init(path.join(__dirname, '..', 'voicevox_core'), ['s0.vvm'], { gpuMode: false });
const wav = backend.synthesizeSong(score, { teacherStyleId: TEACHER, singerStyleId });
if (!wav) { console.error('歌唱合成失败'); backend.dispose(); process.exit(1); }
fs.writeFileSync(`${prefix}.vocal.wav`, wav);
backend.dispose();
console.log(`唱出 ${syl.length} 字 -> ${prefix}.vocal.wav`);
