// audience: internal
// # tts-kana-probe
// 探 AquesTalk 风记法的合法 mora 与格式:逐个试不同片假名串,看哪些能解析、哪些报错。
// 运行:node tools/tts-kana-probe.js

const path = require('path');
const fs = require('fs');
const koffi = require('koffi');
const { VoicevoxBackend } = require('../src/platform/speech/voicevox-backend');

const VOICE = 2;
const CASES = [
  "コンニチワ'",
  "ニ'ーハオ",
  "ニーハオ'",
  "ウォ'",
  "ウオ'",
  "ファ'",
  "ティ'",
  "ドゥ'",
  "ジェ'",
  "ミェ'",
  "シ'/ニ'",
  "ニ'、ハ'オ"
];

const backend = new VoicevoxBackend({ koffi, path, fs, circuitBreaker: null });
backend.init(path.join(__dirname, '..', 'voicevox_core'), ['0.vvm', '8.vvm'], { gpuMode: false });
backend.warmup();

for (const kana of CASES) {
  try {
    const q = backend.audioQueryFromKana(kana, VOICE);
    const moras = (q.accent_phrases || []).reduce((s, p) => s + (p.moras || []).length, 0);
    console.log(`OK   ${kana}  (mora=${moras})`);
  } catch (e) {
    console.log(`FAIL ${kana}  -> ${String(e.message).slice(0, 60)}`);
  }
}
backend.dispose();
