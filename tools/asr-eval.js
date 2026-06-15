// audience: internal
// # asr-eval
// 中文语音自评台架(合成侧):把若干测试句经凑音素重音核路线合成成 WAV,写到 samples/eval 并附 manifest,
// 交 asr-eval.py 用中文语音识别转写、与目标比对打分,据此自迭代凑音素表而不必每版都问人。
// 运行:node tools/asr-eval.js

const path = require('path');
const fs = require('fs');
const koffi = require('koffi');
const { VoicevoxBackend } = require('../src/platform/speech/voicevox-backend');
const { sentenceToAccentKana, applyMandarinTones, emphasizeFricativeH, markNasalContrast } = require('../src/domain/tts/chinese-phonemes');

const VOICE = 2;
// 测试句:汉字供识别比对,tokens 是带声调的拼音(先手给,接入后由汉字转拼音替代)。
const SENTENCES = [
  { id: 'nihao', hanzi: '你好我是你的桌面宠物很高兴见到你',
    tokens: ['ni3', 'hao3', '，', 'wo3', 'shi4', 'ni3', 'de5', 'zhuo1', 'mian4', 'chong3', 'wu4', '，', 'hen3', 'gao1', 'xing4', 'jian4', 'dao4', 'ni3', '。'] },
  { id: 'xuexi', hanzi: '你知道吗我喜欢学习中文',
    tokens: ['ni3', 'zhi1', 'dao4', 'ma5', '？', 'wo3', 'xi3', 'huan1', 'xue2', 'xi2', 'zhong1', 'wen2', '。'] },
  { id: 'tianqi', hanzi: '今天天气很好我们出去玩吧',
    tokens: ['jin1', 'tian1', 'tian1', 'qi4', 'hen3', 'hao3', '，', 'wo3', 'men5', 'chu1', 'qu4', 'wan2', 'ba5', '。'] },
  { id: 'xiexie', hanzi: '谢谢你我很喜欢你',
    tokens: ['xie4', 'xie5', 'ni3', '，', 'wo3', 'hen3', 'xi3', 'huan1', 'ni3', '。'] }
];

const outDir = path.join(__dirname, 'samples', 'eval');
fs.mkdirSync(outDir, { recursive: true });

const backend = new VoicevoxBackend({ koffi, path, fs, circuitBreaker: null });
backend.init(path.join(__dirname, '..', 'voicevox_core'), ['0.vvm', '8.vvm'], { gpuMode: false });
backend.warmup();

// argv[2] 传语速(默认 1.12),用来扫语速对识别率的影响。
const speed = parseFloat(process.argv[2]) || 1.12;
const manifest = [];
for (const sentence of SENTENCES) {
  const { kana, plan } = sentenceToAccentKana(sentence.tokens);
  const query = backend.audioQueryFromKana(kana, VOICE);
  query.speedScale = speed;
  query.volumeScale = 1.25;
  query.prePhonemeLength = 0.08;
  query.postPhonemeLength = 0.1;
  applyMandarinTones(query, plan);
  emphasizeFricativeH(query);
  markNasalContrast(query, plan);
  const wav = backend.synthesizeQuery(query, VOICE);
  const file = path.join(outDir, `${sentence.id}.wav`);
  fs.writeFileSync(file, wav);
  manifest.push({ id: sentence.id, wav: file, hanzi: sentence.hanzi, kana });
  console.log(`${sentence.id}: ${kana}`);
}
fs.writeFileSync(path.join(outDir, 'manifest.json'), JSON.stringify(manifest, null, 2));
console.log(`已写 ${manifest.length} 句到 ${outDir}`);
backend.dispose();
