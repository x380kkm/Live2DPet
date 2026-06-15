// audience: internal
// # tts-sweep
// 中文语音参数扫描:对标准句按 (toneStrength × spread) 网格逐一合成,各写一份 WAV 与逐音节时间边界到 samples/sweep,
// 附 manifest;交 audio-sweep.py 批量算突兀度与识别率,挑出识别率与自然度最平衡的一组音高参数。
// 运行:node tools/tts-sweep.js
const path = require('path'); const fs = require('fs'); const koffi = require('koffi');
const { VoicevoxBackend } = require('../src/platform/speech/voicevox-backend');
const { sentenceToAccentKana, applyMandarinTones, shapeChineseRhythm } = require('../src/domain/tts/chinese-phonemes');

const VOICE = 2;
const HANZI = '你好我是四国玫碳';
const TOKENS = ['ni3', 'hao3', '，', 'wo3', 'shi4', 'si4', 'guo2', 'mei2', 'tan4', '。'];
const LABELS = TOKENS.filter((t) => !/^[，。、!?！？；;：:]+$/.test(t));

// 扫描网格:toneStrength 四声替换强度、spread 四声落差缩放。含当前默认 (1.0, 1.1) 作基线对照。
const TONE_STRENGTHS = [0.55, 0.7, 0.85, 1.0];
const SPREADS = [0.7, 0.9, 1.1];

//// 按 query 累计逐音节时间边界:语速 1.0 时合成时长即各 mora 辅音+元音之和,句首有 prePhonemeLength ////
function boundaries(query, plan) {
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
  return { total, syllables, pauses };
}
//// /按 query 累计逐音节时间边界 ////

const outDir = path.join(__dirname, 'samples', 'sweep');
fs.rmSync(outDir, { recursive: true, force: true });
fs.mkdirSync(outDir, { recursive: true });

const backend = new VoicevoxBackend({ koffi, path, fs, circuitBreaker: null });
backend.init(path.join(__dirname, '..', 'voicevox_core'), ['0.vvm', '8.vvm'], { gpuMode: false });
backend.warmup();

const manifest = [];
for (const toneStrength of TONE_STRENGTHS) {
  for (const spread of SPREADS) {
    const tag = `ts${toneStrength}_sp${spread}`.replace(/\./g, '');
    const { kana, plan } = sentenceToAccentKana(TOKENS);
    const query = backend.audioQueryFromKana(kana, VOICE);
    query.speedScale = 1.0; query.volumeScale = 1.25; query.prePhonemeLength = 0.08; query.postPhonemeLength = 0.1;
    applyMandarinTones(query, plan, { toneStrength, spread });
    shapeChineseRhythm(query);
    const wav = backend.synthesizeQuery(query, VOICE);
    const wavPath = path.join(outDir, `${tag}.wav`);
    fs.writeFileSync(wavPath, wav);
    const b = boundaries(query, plan);
    manifest.push({ tag, toneStrength, spread, wav: wavPath, hanzi: HANZI, kana, ...b });
    console.log(`${tag}: 时长${b.total.toFixed(2)}s ${kana}`);
  }
}
fs.writeFileSync(path.join(outDir, 'manifest.json'), JSON.stringify(manifest, null, 2));
console.log(`\n已写 ${manifest.length} 组到 ${outDir}`);
backend.dispose();
