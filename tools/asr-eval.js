// audience: internal
// # asr-eval
// 中文语音自评台架(合成侧):把若干测试句经凑音素重音核路线合成成 WAV,写到 samples/eval 并附 manifest,
// 交 asr-eval.py 用中文语音识别转写、与目标比对打分,据此自迭代凑音素表而不必每版都问人。
// 运行:node tools/asr-eval.js

const path = require('path');
const fs = require('fs');
const koffi = require('koffi');
const { VoicevoxBackend } = require('../src/platform/speech/voicevox-backend');
const { applyChineseProsody } = require('../src/domain/tts/chinese-phonemes');
const { textToAccentKana } = require('../src/domain/tts/chinese-text');

const VOICE = 2;
// 测试句:直接给汉字(含标点),走与生产同形的文本转拼音 + 按词切分路径合成,识别结果即真实链路的识别率。
const SENTENCES = [
  { id: 'nihao', hanzi: '你好，我是四国玫碳。' },
  { id: 'xuexi', hanzi: '你知道吗？我喜欢学习中文。' },
  { id: 'tianqi', hanzi: '今天天气很好，我们出去玩吧。' },
  { id: 'xiexie', hanzi: '谢谢你，我很喜欢你。' }
];

const outDir = path.join(__dirname, 'samples', 'eval');
fs.mkdirSync(outDir, { recursive: true });

const backend = new VoicevoxBackend({ koffi, path, fs, circuitBreaker: null });
backend.init(path.join(__dirname, '..', 'voicevox_core'), ['0.vvm', '8.vvm'], { gpuMode: false });
backend.warmup();

// argv[2] 语速(默认 1.2,中文连读推荐值);argv[3] 四声强度 toneStrength、argv[4] 四声落差 spread,用来扫音高参数对识别率的影响。
const speed = parseFloat(process.argv[2]) || 1.2;
const toneCfg = {};
if (process.argv[3]) toneCfg.toneStrength = parseFloat(process.argv[3]);
if (process.argv[4]) toneCfg.spread = parseFloat(process.argv[4]);
const manifest = [];
for (const sentence of SENTENCES) {
  const { kana, plan } = textToAccentKana(sentence.hanzi);
  const query = backend.audioQueryFromKana(kana, VOICE);
  query.speedScale = speed;
  query.volumeScale = 1.25;
  query.prePhonemeLength = 0.08;
  query.postPhonemeLength = 0.1;
  applyChineseProsody(query, plan, toneCfg);
  const wav = backend.synthesizeQuery(query, VOICE);
  const file = path.join(outDir, `${sentence.id}.wav`);
  fs.writeFileSync(file, wav);
  manifest.push({ id: sentence.id, wav: file, hanzi: sentence.hanzi, kana });
  console.log(`${sentence.id}: ${kana}`);
}
fs.writeFileSync(path.join(outDir, 'manifest.json'), JSON.stringify(manifest, null, 2));
console.log(`已写 ${manifest.length} 句到 ${outDir}`);
backend.dispose();
