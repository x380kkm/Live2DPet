// audience: internal
// # tts-prosody-probe
// 真机探针:对一段多句长台词,量出中性与各情绪(标量微调后)的韵律特征,演示「判断语音情况」的能力。
// 运行:node tools/tts-prosody-probe.js

const path = require('path');
const fs = require('fs');
const koffi = require('koffi');
const { VoicevoxBackend } = require('../src/platform/speech/voicevox-backend');
const { analyze } = require('../src/domain/tts/prosody-analyzer');
const { shape } = require('../src/domain/tts/prosody-shaper');
const { toneFor } = require('../src/domain/tts/tone-map');

const TEXT = '今日はいい天気だね。一緒にお散歩でもしようか。それとも、おうちでゆっくり過ごす?';
const VOICE = 2;

//// 把标量微调量叠到 query 上,模拟合成时的标量部分 [@busybee 2026-06-14] ////
function applyScalar(query, tone) {
  if (!tone) return query;
  if (tone.intonationScale != null) query.intonationScale = tone.intonationScale;
  if (tone.pitchDelta != null) query.pitchScale = (query.pitchScale || 0) + tone.pitchDelta;
  if (tone.speedMul != null) query.speedScale = (query.speedScale || 1) * tone.speedMul;
  return query;
}

const backend = new VoicevoxBackend({ koffi, path, fs, circuitBreaker: null });
backend.init(path.join(__dirname, '..', 'voicevox_core'), ['0.vvm', '8.vvm'], { gpuMode: false });

const fmt = (f) => `时长=${f.durationSec.toFixed(2)}s 语速=${f.rateMoraPerSec.toFixed(1)}音节/s 音高均=${f.pitchMean.toFixed(2)} 起伏=${f.pitchStd.toFixed(3)} 逐句落差=${f.phraseStdSpread.toFixed(3)} 句尾Δ=${f.finalDelta.toFixed(2)} 停顿=${f.pauseCount}个/${f.pauseTotalSec.toFixed(2)}s`;

for (const emotion of [null, 'happy', 'excited', 'sad', 'calm', 'surprised']) {
  const tone = emotion ? toneFor(emotion) : null;
  const q = applyScalar(backend.audioQuery(TEXT, VOICE), tone);
  if (tone) shape(q, tone);
  console.log(`${(emotion || '中性').padEnd(8)} ${fmt(analyze(q))}`);
}
backend.dispose();
