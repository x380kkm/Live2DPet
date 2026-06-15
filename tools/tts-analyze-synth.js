// audience: internal
// # tts-analyze-synth
// 合成标准句并导出 WAV 与逐音节时间边界(供音频图分析对齐到字)。可传配置覆盖默认音高参数。
// 运行:node tools/tts-analyze-synth.js [spread] [blend] [finalTail]
const path = require('path'); const fs = require('fs'); const koffi = require('koffi');
const { VoicevoxBackend } = require('../src/platform/speech/voicevox-backend');
const { sentenceToAccentKana, applyMandarinTones, shapeChineseRhythm, splitFinalAspiratedStop } = require('../src/domain/tts/chinese-phonemes');
const VOICE = 2;
const TOKENS = ['ni3','hao3','，','wo3','shi4','si4','guo2','mei2','tan4','。'];
// 非标点 token 作逐音节标签(拼音),与 plan 一一对应。
const LABELS = TOKENS.filter((t) => !/^[，。、!?！？；;：:]+$/.test(t));
const cfg = {};
if (process.argv[2]) cfg.toneStrength = parseFloat(process.argv[2]);
if (process.argv[3]) cfg.spread = parseFloat(process.argv[3]);

const outDir = path.join(__dirname, 'samples', 'analyze');
fs.mkdirSync(outDir, { recursive: true });
const backend = new VoicevoxBackend({ koffi, path, fs, circuitBreaker: null });
backend.init(path.join(__dirname, '..', 'voicevox_core'), ['0.vvm', '8.vvm'], { gpuMode: false });
backend.warmup();
const { kana, plan } = sentenceToAccentKana(TOKENS);
const query = backend.audioQueryFromKana(kana, VOICE);
query.speedScale = 1.2; query.volumeScale = 1.25; query.prePhonemeLength = 0.08; query.postPhonemeLength = 0.1;
applyMandarinTones(query, plan, cfg);
shapeChineseRhythm(query);
splitFinalAspiratedStop(query, plan);
const wav = backend.synthesizeQuery(query, VOICE);
const wavPath = path.join(outDir, 'std.wav');
fs.writeFileSync(wavPath, wav);

// 按 query 时长累计逐音节时间边界:语速 1.0 时合成时长即各 mora 的辅音+元音之和,句首有 prePhonemeLength。
const events = [];
for (const ph of query.accent_phrases) {
  for (const m of ph.moras) events.push({ type: 'mora', m });
  if (ph.pause_mora) events.push({ type: 'pause', dur: ph.pause_mora.vowel_length || 0 });
}
let t = query.prePhonemeLength || 0;
const syllables = []; const pauses = [];
let si = 0; let covered = 0; let sylStart = null;
for (const ev of events) {
  if (ev.type === 'pause') { const p0 = t; t += ev.dur; pauses.push([p0, t]); continue; }
  const m = ev.m;
  if (sylStart === null) sylStart = t;
  t += (m.consonant_length || 0) + (m.vowel_length || 0);
  covered += (m.text || '').length || 1;
  if (covered >= (plan[si].kana || '').length) {
    syllables.push({ label: LABELS[si] || `s${si}`, tone: plan[si].tone, start: sylStart, end: t });
    si += 1; covered = 0; sylStart = null;
  }
}
const total = t + (query.postPhonemeLength || 0);
fs.writeFileSync(path.join(outDir, 'std.json'), JSON.stringify({ wav: wavPath, total, config: cfg, syllables, pauses }, null, 2));
console.log(`已写 ${wavPath} 与边界 std.json;config=${JSON.stringify(cfg)} 总时长≈${total.toFixed(2)}s 音节数=${syllables.length}`);
backend.dispose();
