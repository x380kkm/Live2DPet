// audience: internal
// # tts-smoke
// VOICEVOX 后端的真机冒烟:按命令行参数选 CPU 或 GPU 一种加速模式,初始化、合成一句日语、校验 WAV 头与时长并落盘。
// 每个进程只跑一种模式:koffi 的不透明类型全局只能注册一次,CPU 与 GPU 必须分进程跑。
// 运行:node tools/tts-smoke.js cpu  或  node tools/tts-smoke.js gpu

const path = require('path');
const fs = require('fs');
const koffi = require('koffi');
const { VoicevoxBackend } = require('../src/platform/speech/voicevox-backend');

const MODE = (process.argv[2] || 'cpu').toLowerCase();
const WANT_GPU = MODE === 'gpu';
const VOICEVOX_DIR = path.join(__dirname, '..', 'voicevox_core');
const TEXT = 'こんにちは、今日はいい天気ですね。';

//// 校验 WAV 头并据字节率算时长,空或头无效则抛错 [@busybee 2026-06-14] ////
function validateWav(buf) {
  if (!buf || buf.length <= 44) {
    throw new Error('WAV 为空或过短');
  }
  if (buf.toString('ascii', 0, 4) !== 'RIFF' || buf.toString('ascii', 8, 12) !== 'WAVE') {
    throw new Error('WAV 头无效');
  }
  const byteRate = buf.readUInt32LE(28);
  return byteRate ? ((buf.length - 44) / byteRate) * 1000 : 0;
}
//// /校验 WAV 头并据字节率算时长 ////

//// 初始化指定加速模式的后端,预热、合成、再合成验缓存,校验落盘并打印结果 [@busybee 2026-06-14] ////
function main() {
  const backend = new VoicevoxBackend({ koffi, path, fs, circuitBreaker: null });
  const ok = backend.init(VOICEVOX_DIR, ['0.vvm'], { gpuMode: WANT_GPU });
  if (!ok) {
    console.log(`[tts-smoke ${MODE}] 初始化失败,资源目录:${VOICEVOX_DIR}`);
    process.exit(2);
  }
  const version = backend.getVersion();

  const warmT0 = process.hrtime.bigint();
  backend.warmup();
  const warmupMs = Number(process.hrtime.bigint() - warmT0) / 1e6;

  const firstT0 = process.hrtime.bigint();
  const wav = backend.synthesize(TEXT);
  const firstMs = Number(process.hrtime.bigint() - firstT0) / 1e6;
  if (!wav) {
    console.log(`[tts-smoke ${MODE}] 合成返回空`);
    backend.dispose();
    process.exit(3);
  }

  const cacheT0 = process.hrtime.bigint();
  const wav2 = backend.synthesize(TEXT);
  const cacheMs = Number(process.hrtime.bigint() - cacheT0) / 1e6;
  const cacheHit = wav2 === wav;

  // 同文本叠加 happy 语气,输出应与无语气不同(键含语气,不命中无语气缓存)。
  const toneWav = backend.synthesize(TEXT, { tone: { intonationScale: 1.4, prePhonemeLength: 0.05, postPhonemeLength: 0.1 } });
  const toneDiffers = Boolean(toneWav) && !toneWav.equals(wav);

  const durationMs = validateWav(wav);
  fs.writeFileSync(path.join(__dirname, `tts-smoke-${MODE}.wav`), wav);
  console.log(`[tts-smoke ${MODE}] core=${version} 请求GPU=${WANT_GPU} 实际GPU=${backend.isGpu} WAV=${wav.length}字节 音频时长=${durationMs.toFixed(0)}ms 预热=${warmupMs.toFixed(0)}ms 首句=${firstMs.toFixed(0)}ms 二次=${cacheMs.toFixed(1)}ms 命中缓存=${cacheHit} 语气改变输出=${toneDiffers}`);
  if (WANT_GPU && !backend.isGpu) {
    console.log(`[tts-smoke ${MODE}] 注意:DirectML onnx 缺失已回退 CPU;装上 voicevox_onnxruntime-win-x64-dml-1.17.3 才能真用 GPU`);
  }
  backend.dispose();
}
//// /初始化指定加速模式的后端,预热、合成、再合成验缓存,校验落盘并打印结果 ////

main();
