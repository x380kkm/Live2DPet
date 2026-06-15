// audience: internal
// # tts-chinese-text
// 任意中文文本试听:把命令行传入的整句中文经 文本转拼音 → 凑日文音素 → 四声音高 → 节奏整形 → 句末送气 合成 WAV。
// 这是接入生产时的同形路径(输入是文本、不是手给拼音)。运行:node tools/tts-chinese-text.js "你想说的话"
const path = require('path'); const fs = require('fs'); const koffi = require('koffi');
const { VoicevoxBackend } = require('../src/platform/speech/voicevox-backend');
const { textToPinyinTokens } = require('../src/domain/tts/chinese-text');
const { sentenceToAccentKana, applyMandarinTones, shapeChineseRhythm, splitFinalAspiratedStop, CHINESE_QUERY_DEFAULTS } = require('../src/domain/tts/chinese-phonemes');

const VOICE = 2;
const text = process.argv[2] || '你好，我是你的桌面宠物，很高兴见到你。';
const outName = process.argv[3] || 'chinese-text.wav';

const tokens = textToPinyinTokens(text);
const { kana, plan } = sentenceToAccentKana(tokens);
console.log(`文本:${text}`);
console.log(`拼音:${tokens.join(' ')}`);
console.log(`片假名:${kana}`);

const outDir = path.join(__dirname, 'samples');
fs.mkdirSync(outDir, { recursive: true });
const backend = new VoicevoxBackend({ koffi, path, fs, circuitBreaker: null });
backend.init(path.join(__dirname, '..', 'voicevox_core'), ['0.vvm', '8.vvm'], { gpuMode: false });
backend.warmup();

const query = backend.audioQueryFromKana(kana, VOICE);
Object.assign(query, CHINESE_QUERY_DEFAULTS);
applyMandarinTones(query, plan);
shapeChineseRhythm(query);
splitFinalAspiratedStop(query, plan);
const wav = backend.synthesizeQuery(query, VOICE);
const file = path.join(outDir, outName);
fs.writeFileSync(file, wav);
console.log(`已存 ${file} 字节=${wav.length}`);
backend.dispose();
