const path = require('path'); const fs = require('fs'); const koffi = require('koffi');
const { VoicevoxBackend } = require('../src/platform/speech/voicevox-backend');
const { sentenceToAccentKana, applyMandarinTones } = require('../src/domain/tts/chinese-phonemes');
const VOICE = 2;
const TOKENS = ['ni3','hao3','，','wo3','shi4','ni3','de5','zhuo1','mian4','chong3','wu4','，','hen3','gao1','xing4','jian4','dao4','ni3','。'];
const { kana, plan } = sentenceToAccentKana(TOKENS);
const b = new VoicevoxBackend({ koffi, path, fs, circuitBreaker: null });
b.init(path.join(__dirname,'..','voicevox_core'), ['0.vvm','8.vvm'], { gpuMode:false }); b.warmup();
const q = b.audioQueryFromKana(kana, VOICE);
applyMandarinTones(q, plan);
// flatten and pair with plan
const moras=[]; for (const ph of q.accent_phrases) for (const m of ph.moras) moras.push(m);
let idx=0;
plan.forEach((syl,i)=>{
  const tgt=syl.kana.length; const g=[]; let cov=0;
  while(idx<moras.length && cov<tgt){ const m=moras[idx++]; cov+=(m.text||'').length||1; g.push(m); }
  console.log(`${String(i).padStart(2)} 调${syl.tone} ${syl.kana.padEnd(4)} ${g.map(m=>`${m.text}:${m.pitch.toFixed(2)}`).join(' ')}`);
});
b.dispose();
