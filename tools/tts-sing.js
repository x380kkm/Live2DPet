// audience: internal
// # tts-sing
// 用歌唱声线把一首中文歌合成成 WAV:歌曲数据经 song-score 拼成曲谱,再走 VOICEVOX 歌唱合成。
// 运行:node tools/tts-sing.js [曲名] [输出路径];曲名默认 molihua,对应 src/domain/tts/songs/<曲名>.js。

const path = require('path');
const fs = require('fs');
const koffi = require('koffi');
const { VoicevoxBackend } = require('../src/platform/speech/voicevox-backend');
const { buildScore } = require('../src/domain/tts/song-score');

// 波音リツ 的 sing 样式,作歌唱教师从曲谱推断音高与音量
const TEACHER_STYLE_ID = 6000;
// 冥鳴ひまり 的 frame_decode 样式,决定歌手音色
const SINGER_STYLE_ID = 3014;

const songName = process.argv[2] || 'molihua';
const outPath = process.argv[3] || path.join(__dirname, `sing-${songName}.wav`);
const song = require(`../src/domain/tts/songs/${songName}`);

const score = buildScore(song.lyrics, song.melody, { bpm: song.bpm });
const backend = new VoicevoxBackend({ koffi, path, fs, circuitBreaker: null });
// s0.vvm 是歌唱模型,含歌唱教师样式 6000 与歌手样式 3014;不加载它则这两个样式都找不到
if (!backend.init(path.join(__dirname, '..', 'voicevox_core'), ['s0.vvm'], { gpuMode: false })) {
  console.error('VOICEVOX 初始化失败,确认 voicevox_core 与 s0.vvm 就位');
  process.exit(1);
}
const wav = backend.synthesizeSong(score, { teacherStyleId: TEACHER_STYLE_ID, singerStyleId: SINGER_STYLE_ID });
if (!wav) {
  console.error('歌唱合成失败');
  backend.dispose();
  process.exit(1);
}
fs.writeFileSync(outPath, wav);
console.log(`${songName}: ${wav.length} bytes -> ${outPath}`);
backend.dispose();
