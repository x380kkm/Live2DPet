// audience: internal
// # tts-timing-dump
// 诊断:打印重音核路线当前流水线下每个音节的辅音/元音时长与停顿,核算节奏是否像中文(音节等长、组内连读、只在标点停顿)。
// 运行:node tools/tts-timing-dump.js
const path = require('path'); const fs = require('fs'); const koffi = require('koffi');
const { VoicevoxBackend } = require('../src/platform/speech/voicevox-backend');
const { sentenceToAccentKana, applyMandarinTones, shapeChineseRhythm } = require('../src/domain/tts/chinese-phonemes');
const VOICE = 2;
const TOKENS = ['ni3','hao3','，','wo3','shi4','ni3','de5','zhuo1','mian4','chong3','wu4','，','hen3','gao1','xing4','jian4','dao4','ni3','。'];
const { kana, plan } = sentenceToAccentKana(TOKENS);
const b = new VoicevoxBackend({ koffi, path, fs, circuitBreaker: null });
b.init(path.join(__dirname,'..','voicevox_core'), ['0.vvm','8.vvm'], { gpuMode:false }); b.warmup();
const q = b.audioQueryFromKana(kana, VOICE);
q.speedScale = 1.0;
applyMandarinTones(q, plan);
shapeChineseRhythm(q);
console.log(`kana: ${kana}`);
console.log(`accent_phrases 个数: ${q.accent_phrases.length}`);
let phraseIdx = 0;
const moras = [];
for (const ph of q.accent_phrases) {
  const parts = [];
  for (const m of ph.moras) {
    const c = m.consonant_length != null ? m.consonant_length : 0;
    const v = m.vowel_length != null ? m.vowel_length : 0;
    parts.push(`${m.text}[c${c.toFixed(3)} v${v.toFixed(3)}]`);
    moras.push(m);
  }
  const pause = ph.pause_mora ? ph.pause_mora.vowel_length : 0;
  console.log(`#${phraseIdx} 停顿${(pause||0).toFixed(3)}  ${parts.join(' ')}`);
  phraseIdx += 1;
}
// 按 plan 把 mora 归回音节,量每个汉字音节的时长是否大致等长(中文音节等时节奏的关键)。
const sylDurations = [];
let idx = 0;
for (const syl of plan) {
  const tgt = syl.kana.length; let cov = 0, dur = 0;
  while (idx < moras.length && cov < tgt) { const m = moras[idx]; idx += 1; cov += (m.text || '').length || 1; dur += (m.consonant_length || 0) + (m.vowel_length || 0); }
  sylDurations.push(dur);
}
const mean = sylDurations.reduce((s, x) => s + x, 0) / sylDurations.length;
const sd = Math.sqrt(sylDurations.reduce((s, x) => s + (x - mean) ** 2, 0) / sylDurations.length);
console.log(`音节时长 均值${mean.toFixed(3)} 标准差${sd.toFixed(3)} 变异系数${(sd / mean).toFixed(3)}(越小越像音节等时的中文节奏)`);
b.dispose();
