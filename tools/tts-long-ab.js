// audience: internal
// # tts-long-ab
// 长台词 A/B:同一条声线、同一段多句台词,合成「语气关(无微调)」与「语气开(情绪 + 句内句间塑形)」两版,供试听长输出差异。
// 运行:node tools/tts-long-ab.js

const path = require('path');
const fs = require('fs');
const koffi = require('koffi');
const { VoicevoxBackend } = require('../src/platform/speech/voicevox-backend');
const { toneFor } = require('../src/domain/tts/tone-map');
const { apply } = require('../src/domain/tts/prosody-shaper');

const VOICE = 2;
const TEXT = 'おかえり!今日はどんな一日だった?わたし、ずっとここで待ってたんだよ。疲れたなら、ちょっと寄りかかって休んでいいからね。';

const VARIANTS = [
  { key: 'long-off', emotion: null },
  { key: 'long-on-happy', emotion: 'happy' },
  { key: 'long-on-sad', emotion: 'sad' }
];

const outDir = path.join(__dirname, 'samples');
fs.mkdirSync(outDir, { recursive: true });

// 注入塑形器,使语气开时句内句间塑形生效。
const backend = new VoicevoxBackend({ koffi, path, fs, circuitBreaker: null, prosodyShaper: apply });
backend.init(path.join(__dirname, '..', 'voicevox_core'), ['0.vvm', '8.vvm'], { gpuMode: false });
backend.warmup();

for (const v of VARIANTS) {
  const tone = v.emotion ? toneFor(v.emotion) : null;
  const wav = backend.synthesize(TEXT, { styleId: VOICE, tone });
  if (!wav) {
    console.log(`${v.key} 合成失败`);
    continue;
  }
  fs.writeFileSync(path.join(outDir, `${v.key}.wav`), wav);
  console.log(`${v.key} 情绪=${v.emotion || '无'} ${wav.length}字节`);
}
backend.dispose();
