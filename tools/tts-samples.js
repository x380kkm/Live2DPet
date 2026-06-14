// audience: internal
// # tts-samples
// 录一组带情绪的语音样本:统一用一条声线,情绪只靠模型内微调(audio_query 参数)做出,不切换声线。
// 第一条无微调作基线,其余各情绪在同一声线上叠加微调。运行:node tools/tts-samples.js

const path = require('path');
const fs = require('fs');
const koffi = require('koffi');
const { VoicevoxBackend } = require('../src/platform/speech/voicevox-backend');
const { toneFor } = require('../src/domain/tts/tone-map');

// 统一声线:四国めたん ノーマル(styleId 2)。用户实际会自己选,这里固定一条以听清模型内微调的效果。
const VOICE = 2;

// 每条样本:文件名键、情绪(空为无微调基线)、中日台词。
const SAMPLES = [
  { key: '00-neutral', emotion: null, ja: 'こんにちは、あなたのデスクトップの相棒だよ。' },
  { key: '01-happy', emotion: 'happy', ja: 'えへへ、今日もあなたと一緒にいられて、すっごく嬉しい!' },
  { key: '02-excited', emotion: 'excited', ja: 'わぁ——やっと帰ってきた、ずーっと待ってたんだから!' },
  { key: '03-shy', emotion: 'shy', ja: 'あの……ずっとそばにいてくれて、ありがとう。' },
  { key: '04-angry', emotion: 'angry', ja: 'もう!のぞき見しないって約束したのに!' },
  { key: '05-sad', emotion: 'sad', ja: 'さっき……わたしのこと、忘れてたでしょ。' },
  { key: '06-calm', emotion: 'calm', ja: '大丈夫だよ、ゆっくりでいいの、ずっとここにいるからね。' }
];

const outDir = path.join(__dirname, 'samples');
fs.mkdirSync(outDir, { recursive: true });

const backend = new VoicevoxBackend({ koffi, path, fs, circuitBreaker: null });
backend.init(path.join(__dirname, '..', 'voicevox_core'), ['0.vvm', '8.vvm'], { gpuMode: false });
backend.warmup();

for (const sample of SAMPLES) {
  const tone = sample.emotion ? toneFor(sample.emotion) : null;
  const wav = backend.synthesize(sample.ja, { styleId: VOICE, tone });
  if (!wav) {
    console.log(`${sample.key} 合成失败`);
    continue;
  }
  const file = path.join(outDir, `${sample.key}.wav`);
  fs.writeFileSync(file, wav);
  console.log(`${sample.key} 情绪=${sample.emotion || '无(基线)'} style=${VOICE} ${wav.length}字节 -> ${file}`);
}
backend.dispose();
