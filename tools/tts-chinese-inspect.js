// audience: internal
// # tts-chinese-inspect
// 诊断用:打印中文测试句的 audio_query 逐 mora 结构(辅音时长、元音时长、音高、停顿),
// 用来定位连读打断感与重音异常的来源。运行:node tools/tts-chinese-inspect.js

const path = require('path');
const fs = require('fs');
const koffi = require('koffi');
const { VoicevoxBackend } = require('../src/platform/speech/voicevox-backend');
const { sentenceToKana, applyTones, flowPhrases } = require('../src/domain/tts/chinese-phonemes');

const VOICE = 2;
const TOKENS = ['ni3', 'hao3', '，', 'wo3', 'shi4', 'ni3', 'de5', 'zhuo1', 'mian4', 'chong3', 'wu4', '，', 'hen3', 'gao1', 'xing4', 'jian4', 'dao4', 'ni3', '。'];

const { kana, plan } = sentenceToKana(TOKENS);
const backend = new VoicevoxBackend({ koffi, path, fs, circuitBreaker: null });
backend.init(path.join(__dirname, '..', 'voicevox_core'), ['0.vvm', '8.vvm'], { gpuMode: false });
backend.warmup();

const query = backend.audioQuery(kana, VOICE);
flowPhrases(query);
applyTones(query, plan);

query.accent_phrases.forEach((ph, i) => {
  const moras = ph.moras.map((m) => {
    const c = m.consonant_length == null ? '-' : m.consonant_length.toFixed(2);
    return `${m.text}[c${c}/v${m.vowel_length.toFixed(2)}/p${m.pitch.toFixed(2)}]`;
  }).join(' ');
  const pause = ph.pause_mora ? ph.pause_mora.vowel_length.toFixed(2) : '-';
  console.log(`P${i} accent=${ph.accent} pause=${pause}\n  ${moras}`);
});
backend.dispose();
