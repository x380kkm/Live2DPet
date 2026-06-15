// audience: internal
// # tts-chinese-kana
// 中文语音·重音核路线试听:把拼音拼成 AquesTalk 风格带重音的片假名,经 create_audio_query_from_kana 取 query,
// 让引擎按重音核自然生成音高(不逐 mora 硬改),再合成。对照逐 mora 改音高的旧路线哪个更自然。
// 运行:node tools/tts-chinese-kana.js

const path = require('path');
const fs = require('fs');
const koffi = require('koffi');
const { VoicevoxBackend } = require('../src/platform/speech/voicevox-backend');
const { sentenceToAccentKana, applyMandarinTones } = require('../src/domain/tts/chinese-phonemes');
const { analyze } = require('../src/domain/tts/prosody-analyzer');

const VOICE = 2;
const TOKENS = [
  'ni3', 'hao3', '，',
  'wo3', 'shi4', 'ni3', 'de5', 'zhuo1', 'mian4', 'chong3', 'wu4', '，',
  'hen3', 'gao1', 'xing4', 'jian4', 'dao4', 'ni3', '。'
];

const outDir = path.join(__dirname, 'samples');
fs.mkdirSync(outDir, { recursive: true });

const { kana, plan } = sentenceToAccentKana(TOKENS);
console.log(`带重音片假名:${kana}`);

const backend = new VoicevoxBackend({ koffi, path, fs, circuitBreaker: null });
backend.init(path.join(__dirname, '..', 'voicevox_core'), ['0.vvm', '8.vvm'], { gpuMode: false });
backend.warmup();

const query = backend.audioQueryFromKana(kana, VOICE);
query.speedScale = 1.0;
// 在重音核路线的自然时长上铺完整四声音高,把四声都做分明。
applyMandarinTones(query, plan);
const wav = backend.synthesizeQuery(query, VOICE);

const f = analyze(query);
const file = path.join(outDir, 'chinese-kana.wav');
fs.writeFileSync(file, wav);
console.log(`已存 ${file} 时长=${f.durationSec.toFixed(2)}s 字节=${wav.length} (${(wav.length / 1048576).toFixed(2)}MB) 音高均=${f.pitchMean.toFixed(2)} 音高幅=${f.pitchRange.toFixed(2)}`);
backend.dispose();
