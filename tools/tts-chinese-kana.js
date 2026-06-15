// audience: internal
// # tts-chinese-kana
// 中文语音·重音核路线试听:把拼音拼成 AquesTalk 风格带重音的片假名,经 create_audio_query_from_kana 取 query,
// 让引擎按重音核自然生成音高(不逐 mora 硬改),再合成。对照逐 mora 改音高的旧路线哪个更自然。
// 运行:node tools/tts-chinese-kana.js

const path = require('path');
const fs = require('fs');
const koffi = require('koffi');
const { VoicevoxBackend } = require('../src/platform/speech/voicevox-backend');
const { sentenceToAccentKana, applyChineseProsody, CHINESE_QUERY_DEFAULTS } = require('../src/domain/tts/chinese-phonemes');
const { analyze } = require('../src/domain/tts/prosody-analyzer');

const VOICE = 2;
// 多句备选:default 是反复迭代的标准句(无卷舌、无 ü,纯纯音素发音);hard 覆盖卷舌、ü、q/x 等难点,压测凑音素表覆盖度。
const SENTENCES = {
  default: [
    'ni3', 'hao3', '，',
    'wo3', 'shi4', 'si4', 'guo2', 'mei2', 'tan4', '。'
  ],
  hard: [
    'ni3', 'zhi1', 'dao4', 'ma5', '？',
    'wo3', 'xi3', 'huan1', 'xue2', 'xi2', 'zhong1', 'wen2', '。'
  ]
};
const key = SENTENCES[process.argv[2]] ? process.argv[2] : 'default';
const TOKENS = SENTENCES[key];
const OUT_NAME = key === 'default' ? 'chinese-kana.wav' : `chinese-${key}.wav`;

const outDir = path.join(__dirname, 'samples');
fs.mkdirSync(outDir, { recursive: true });

const { kana, plan } = sentenceToAccentKana(TOKENS, { sandhi: true });
console.log(`带重音片假名:${kana}`);

const backend = new VoicevoxBackend({ koffi, path, fs, circuitBreaker: null });
backend.init(path.join(__dirname, '..', 'voicevox_core'), ['0.vvm', '8.vvm'], { gpuMode: false });
backend.warmup();

const query = backend.audioQueryFromKana(kana, VOICE);
// 套用实听定下的中文合成推荐参数(语速 1.1 连读、音量 1.25、收句首尾留白)。
Object.assign(query, CHINESE_QUERY_DEFAULTS);
// 整条中文韵律:铺四声、连读收停顿、拉平音节时长匀节奏、句末送气字落到短语首。
applyChineseProsody(query, plan);
const wav = backend.synthesizeQuery(query, VOICE);

const f = analyze(query);
const file = path.join(outDir, OUT_NAME);
fs.writeFileSync(file, wav);
console.log(`已存 ${file} 时长=${f.durationSec.toFixed(2)}s 字节=${wav.length} (${(wav.length / 1048576).toFixed(2)}MB) 音高均=${f.pitchMean.toFixed(2)} 音高幅=${f.pitchRange.toFixed(2)}`);
backend.dispose();
