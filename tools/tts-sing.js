// audience: internal
// # tts-sing
// 用歌唱声线把一首中文歌合成成 WAV:歌曲数据经 song-score 拼成曲谱,再走 VOICEVOX 歌唱合成。
// 运行:node tools/tts-sing.js [曲名] [歌手样式id] [输出路径] [--hum[=假名]]
//   曲名默认 molihua,歌手样式默认 3046(小夜/SAYO),亦可传如 3047(ナースロボ＿タイプＴ)。
//   带 --hum 走哼唱(不唱歌词、每音符一个中性 mora,默认 ン,--hum=ラ 可换)。

const path = require('path');
const fs = require('fs');
const koffi = require('koffi');
const { VoicevoxBackend } = require('../src/platform/speech/voicevox-backend');
const { buildScore, hummingScore } = require('../src/domain/tts/song-score');

// 波音リツ 的 sing 样式,作歌唱教师从曲谱推断音高与音量
const TEACHER_STYLE_ID = 6000;
// 默认歌手音色:冥鳴ひまり 的 frame_decode 样式;可由命令行参数覆盖
const SINGER_STYLE_ID = 3046;

const args = process.argv.slice(2);
const humArg = args.find((a) => a.startsWith('--hum'));
const humMora = humArg ? (humArg.includes('=') ? humArg.split('=')[1] : 'ン') : null;
const positional = args.filter((a) => !a.startsWith('--'));
const songName = positional[0] || 'molihua';
const singerStyleId = positional[1] ? parseInt(positional[1], 10) : SINGER_STYLE_ID;
const outPath = positional[2] || path.join(__dirname, `${humMora ? 'hum' : 'sing'}-${songName}-${singerStyleId}.wav`);
const song = require(`../src/domain/tts/songs/${songName}`);

const score = humMora
  ? hummingScore(song.melody, { bpm: song.bpm, mora: humMora })
  : buildScore(song.lyrics, song.melody, { bpm: song.bpm });
const backend = new VoicevoxBackend({ koffi, path, fs, circuitBreaker: null });
// s0.vvm 是歌唱模型,含歌唱教师样式 6000 与歌手样式 3014;不加载它则这两个样式都找不到
if (!backend.init(path.join(__dirname, '..', 'voicevox_core'), ['s0.vvm'], { gpuMode: false })) {
  console.error('VOICEVOX 初始化失败,确认 voicevox_core 与 s0.vvm 就位');
  process.exit(1);
}
const wav = backend.synthesizeSong(score, { teacherStyleId: TEACHER_STYLE_ID, singerStyleId });
if (!wav) {
  console.error('歌唱合成失败');
  backend.dispose();
  process.exit(1);
}
fs.writeFileSync(outPath, wav);
console.log(`${songName} (歌手 ${singerStyleId}${humMora ? `, 哼唱 ${humMora}` : ''}): ${wav.length} bytes -> ${outPath}`);
backend.dispose();
