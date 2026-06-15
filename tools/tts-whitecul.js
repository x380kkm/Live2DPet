// audience: internal
// # tts-whitecul
// 用 WhiteCUL びえーん(styleId 26)走调好的朗读:对一段叙事取 audio_query、叠朗读结构韵律(句内下倾、
// 边界调型、停顿前延长),整段合成。输出控制在约 20 秒、1MB 以内,便于回传试听。
// 运行:node tools/tts-whitecul.js

const path = require('path');
const fs = require('fs');
const koffi = require('koffi');
const { VoicevoxBackend } = require('../src/platform/speech/voicevox-backend');
const { applyNarration } = require('../src/domain/tts/prosody-shaper');
const { analyze } = require('../src/domain/tts/prosody-analyzer');

// WhiteCUL びえーん。
const VOICE = 26;
// 调好的朗读取クソデカ羅生門开头三句,长度落在约 20 秒、1MB 以内。
const TEXT = 'ある日の超暮方の事である。一人の下人が、クソデカい羅生門の完全な真下で、雨やみをずっと待ちまくっていた。馬鹿みたいに広い門の真下には、この大男のほかに全然誰もいない。';

// 回传体积上限对应的时长:24kHz 单声道 16 位,每秒约 48000 字节,封顶 20 秒约 960KB。
const MAX_SEC = 20;

//// 把 WAV 截到不超过指定秒数,末尾加 0.12 秒淡出避免硬切 [@x380kkm 2026-06-14] ////
function capDuration(wav, maxSec) {
  const sampleRate = wav.readUInt32LE(24);
  const channels = wav.readUInt16LE(22);
  const bytesPerSample = wav.readUInt16LE(34) / 8;
  const frameBytes = channels * bytesPerSample;
  const headerLen = 44;
  const totalFrames = Math.floor((wav.length - headerLen) / frameBytes);
  const maxFrames = Math.floor(maxSec * sampleRate);
  if (totalFrames <= maxFrames) {
    return wav;
  }
  const pcm = wav.slice(headerLen, headerLen + maxFrames * frameBytes);
  const fadeFrames = Math.floor(0.12 * sampleRate);
  for (let i = 0; i < fadeFrames; i++) {
    const gain = (fadeFrames - i) / fadeFrames;
    const at = (maxFrames - fadeFrames + i) * frameBytes;
    for (let c = 0; c < channels; c++) {
      const off = at + c * bytesPerSample;
      pcm.writeInt16LE(Math.round(pcm.readInt16LE(off) * gain), off);
    }
  }
  const out = Buffer.alloc(headerLen + pcm.length);
  wav.copy(out, 0, 0, headerLen);
  out.writeUInt32LE(36 + pcm.length, 4);
  out.writeUInt32LE(pcm.length, 40);
  pcm.copy(out, headerLen);
  return out;
}
//// /把 WAV 截到不超过指定秒数 ////

const outDir = path.join(__dirname, 'samples');
fs.mkdirSync(outDir, { recursive: true });

const backend = new VoicevoxBackend({ koffi, path, fs, circuitBreaker: null });
backend.init(path.join(__dirname, '..', 'voicevox_core'), ['0.vvm', '8.vvm'], { gpuMode: false });
backend.warmup();

const query = backend.audioQuery(TEXT, VOICE);
applyNarration(query);
const raw = backend.synthesizeQuery(query, VOICE);
const wav = capDuration(raw, MAX_SEC);

const f = analyze(query);
const file = path.join(outDir, 'whitecul-bien-narration.wav');
fs.writeFileSync(file, wav);
console.log(`已存 ${file}`);
console.log(`时长(整段)=${f.durationSec.toFixed(2)}s 截后字节=${wav.length} (${(wav.length / 1048576).toFixed(2)}MB) 音高均=${f.pitchMean.toFixed(2)} 停顿数=${f.pauseCount}`);
backend.dispose();
