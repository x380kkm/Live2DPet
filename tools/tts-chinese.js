// audience: internal
// # tts-chinese
// 中文语音试听:把一句拼音(带声调)经凑音素层拼成片假名,走日语 VOICEVOX 取 audio_query,
// 按四声改各 mora 音高,再合成。打印拼出的片假名与声调计划,输出控制在 1MB 内便于回传试听。
// 运行:node tools/tts-chinese.js

const path = require('path');
const fs = require('fs');
const koffi = require('koffi');
const { VoicevoxBackend } = require('../src/platform/speech/voicevox-backend');
const { sentenceToKana, applyTones, flowPhrases, shapeFlow } = require('../src/domain/tts/chinese-phonemes');
const { analyze } = require('../src/domain/tts/prosody-analyzer');

// 四国めたん ノーマル:清晰的女声,便于先判清凑音素与声调;声线可换。
const VOICE = 2;
// 测试句:你好,我是你的桌面宠物,很高兴见到你。
const TOKENS = [
  'ni3', 'hao3', '，',
  'wo3', 'shi4', 'ni3', 'de5', 'zhuo1', 'mian4', 'chong3', 'wu4', '，',
  'hen3', 'gao1', 'xing4', 'jian4', 'dao4', 'ni3', '。'
];

const outDir = path.join(__dirname, 'samples');
fs.mkdirSync(outDir, { recursive: true });

const { kana, plan } = sentenceToKana(TOKENS);
console.log(`拼出片假名:${kana}`);
console.log(`声调计划:${plan.map((p) => `${p.tone}调/${p.moras}音`).join(' ')}`);

const backend = new VoicevoxBackend({ koffi, path, fs, circuitBreaker: null });
backend.init(path.join(__dirname, '..', 'voicevox_core'), ['0.vvm', '8.vvm'], { gpuMode: false });
backend.warmup();

const query = backend.audioQuery(kana, VOICE);
// 稍放慢,给四声调型与韵尾更多发音时间。
query.speedScale = 0.92;
const phrasesBefore = (query.accent_phrases || []).length;
// 合并词间停顿组、抻长元音压短辅音让连读连贯,再按声调改音高。
flowPhrases(query);
const phrasesAfter = (query.accent_phrases || []).length;
shapeFlow(query);
const moraTotal = (query.accent_phrases || []).reduce((sum, ph) => sum + (ph.moras || []).length, 0);
applyTones(query, plan);
const wav = backend.synthesizeQuery(query, VOICE);
console.log(`accent_phrase 合并:${phrasesBefore} → ${phrasesAfter}`);

const f = analyze(query);
const file = path.join(outDir, 'chinese-nihao.wav');
fs.writeFileSync(file, wav);
console.log(`已存 ${file}`);
console.log(`query 总 mora=${moraTotal} 计划音节=${plan.length}(各音节 mora 合计=${plan.reduce((s, p) => s + p.moras, 0)}) 时长=${f.durationSec.toFixed(2)}s 字节=${wav.length} (${(wav.length / 1048576).toFixed(2)}MB)`);
backend.dispose();
