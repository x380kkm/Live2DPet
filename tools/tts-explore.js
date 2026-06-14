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
//// 把最后一个有声 mora 的元音时长按系数缩短,让句尾更干脆 [@busybee 2026-06-14] ////
function shortenFinal(query, factor) {
  const phrases = query.accent_phrases || [];
  for (let i = phrases.length - 1; i >= 0; i--) {
    const voiced = (phrases[i].moras || []).filter((m) => m.pitch > 0);
    if (voiced.length) {
      voiced[voiced.length - 1].vowel_length *= factor;
      return;
    }
  }
}
//// /把最后一个有声 mora 的元音时长按系数缩短 ////

// 本轮探句尾干脆度:缩短末音节、压掉句尾留白。set 改全局量,tweak 改 query(如末音节)。
const CONFIGS = [
  { key: '01-基准', set: {} },
  { key: '02-尾静音0.02', set: { postPhonemeLength: 0.02 } },
  { key: '03-末音0.7', set: {}, tweak: (q) => shortenFinal(q, 0.7) },
  { key: '04-末音0.7尾0.02', set: { postPhonemeLength: 0.02 }, tweak: (q) => shortenFinal(q, 0.7) },
  { key: '05-末音0.5尾0.02', set: { postPhonemeLength: 0.02 }, tweak: (q) => shortenFinal(q, 0.5) },
  { key: '06-末音0.6尾0', set: { postPhonemeLength: 0.0 }, tweak: (q) => shortenFinal(q, 0.6) }
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
  if (config.tweak) config.tweak(query);
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
