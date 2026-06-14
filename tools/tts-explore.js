// audience: internal
// # tts-explore
// 参数探索台架:对一句短测试句,套一批不同的 audio_query 参数配置分别合成,打印可量化指标,
// 并把所有变体按顺序拼成一个 montage 音频(段间留 0.4 秒空)便于一次听完对比、挑出可用的留下。
// 运行:node tools/tts-explore.js

const path = require('path');
const fs = require('fs');
const koffi = require('koffi');
const { VoicevoxBackend } = require('../src/platform/speech/voicevox-backend');
const { analyze } = require('../src/domain/tts/prosody-analyzer');

const VOICE = 2;
const TEXT = '今日も会えて嬉しい。';

// 一批待探索的原生参数配置:每个改几个全局量,看效果。后续从听感可用的里找规律。
const CONFIGS = [
  { key: '01-base', set: {} },
  { key: '02-语调1.5', set: { intonationScale: 1.5 } },
  { key: '03-语调0.7', set: { intonationScale: 0.7 } },
  { key: '04-音高+0.04', set: { pitchScale: 0.04 } },
  { key: '05-语速0.9', set: { speedScale: 0.9 } },
  { key: '06-活泼组合', set: { intonationScale: 1.5, pitchScale: 0.03, speedScale: 1.05 } }
];

//// 把若干段 WAV 按顺序拼接,段间插指定秒数静音,得到一个 montage WAV [@busybee 2026-06-14] ////
function buildMontage(segments, gapSec) {
  const first = segments[0].wav;
  const sampleRate = first.readUInt32LE(24);
  const numChannels = first.readUInt16LE(22);
  const bytesPerSample = first.readUInt16LE(34) / 8;
  const gap = Buffer.alloc(Math.floor(sampleRate * gapSec) * numChannels * bytesPerSample);
  const parts = [];
  segments.forEach((s, i) => {
    if (i > 0) parts.push(gap);
    parts.push(s.wav.slice(44));
  });
  const pcm = Buffer.concat(parts);
  const out = Buffer.alloc(44 + pcm.length);
  first.copy(out, 0, 0, 44);
  out.writeUInt32LE(36 + pcm.length, 4);
  out.writeUInt32LE(pcm.length, 40);
  pcm.copy(out, 44);
  return out;
}
//// /把若干段 WAV 拼接成 montage ////

const outDir = path.join(__dirname, 'samples');
fs.mkdirSync(outDir, { recursive: true });

const backend = new VoicevoxBackend({ koffi, path, fs, circuitBreaker: null });
backend.init(path.join(__dirname, '..', 'voicevox_core'), ['0.vvm', '8.vvm'], { gpuMode: false });
backend.warmup();

const segments = [];
for (const config of CONFIGS) {
  const query = backend.audioQuery(TEXT, VOICE);
  Object.assign(query, config.set);
  const wav = backend.synthesizeQuery(query, VOICE);
  const f = analyze(query);
  console.log(`${config.key.padEnd(14)} 时长=${f.durationSec.toFixed(2)}s 音高均=${f.pitchMean.toFixed(2)} 参数=${JSON.stringify(config.set)}`);
  if (wav) segments.push({ key: config.key, wav });
}

const montage = buildMontage(segments, 0.4);
const file = path.join(outDir, 'explore-montage.wav');
fs.writeFileSync(file, montage);
console.log(`montage 已存 ${file} ${(montage.length / 1048576).toFixed(2)}MB`);
backend.dispose();
