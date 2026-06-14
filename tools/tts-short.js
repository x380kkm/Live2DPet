// audience: internal
// # tts-short
// 短片段试听:只合成长文本开头一两句,基线与平静叙事两版,产出更小的文件便于投递与试听。
// 运行:node tools/tts-short.js

const path = require('path');
const fs = require('fs');
const koffi = require('koffi');
const { VoicevoxBackend } = require('../src/platform/speech/voicevox-backend');
const { TtsOrchestrator } = require('../src/domain/tts/tts-orchestrator');
const { Utterance } = require('../src/domain/speech/utterance');
const { toneFor } = require('../src/domain/tts/tone-map');
const { apply } = require('../src/domain/tts/prosody-shaper');

const VOICE = 2;
const TEXT = 'ある日の超暮方の事である。一人の下人が、クソデカい羅生門の真下で雨やみをずっと待っていた。だが、門の下にはこの大男のほかに誰もいない。';

const outDir = path.join(__dirname, 'samples');
fs.mkdirSync(outDir, { recursive: true });

const backend = new VoicevoxBackend({ koffi, path, fs, circuitBreaker: null, prosodyShaper: apply });
backend.init(path.join(__dirname, '..', 'voicevox_core'), ['0.vvm', '8.vvm'], { gpuMode: false });
backend.setConfig({ styleId: VOICE });
backend.warmup();
// demo 用小分句上限,使每句成一块,断句处都插气音便于试听。
const orchestrator = new TtsOrchestrator({ speechBackend: backend, maxChunkLen: 24 });

for (const [key, emotion] of [['short-off', null], ['short-calm', 'calm']]) {
  const utterance = Utterance.of(TEXT);
  orchestrator.synthesize(utterance, emotion ? { tone: toneFor(emotion), breath: true } : {});
  if (!utterance.hasAudio()) {
    console.log(`${key} 无音频`);
    continue;
  }
  fs.writeFileSync(path.join(outDir, `${key}.wav`), utterance.audioAlignment.audio);
  console.log(`${key} 情绪=${emotion || '无'} ${utterance.audioAlignment.audio.length}字节`);
}
backend.dispose();
