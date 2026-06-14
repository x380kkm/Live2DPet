// audience: internal
// # tts-iterate
// 停顿占比判断器探针:对长文本逐块取 audio_query、施加塑形,统计句间停顿与块间留白占总时长的比例,
// 供自驱迭代降停顿,不渲染音频、跑得快。运行:node tools/tts-iterate.js

const path = require('path');
const fs = require('fs');
const koffi = require('koffi');
const { VoicevoxBackend } = require('../src/platform/speech/voicevox-backend');
const { TtsOrchestrator } = require('../src/domain/tts/tts-orchestrator');
const { analyze } = require('../src/domain/tts/prosody-analyzer');
const { shape, applyNarration } = require('../src/domain/tts/prosody-shaper');
const { toneFor } = require('../src/domain/tts/tone-map');

const VOICE = 2;
const RAW = `ある日の超暮方(ほぼ夜)の事である。一人の下人が、クソデカい羅生門の完全な真下で雨やみを気持ち悪いほどずっと待ちまくっていた。
馬鹿みたいに広い門の真下には、この大男のほかに全然誰もいない。ただ、所々丹塗のびっくりするくらい剥げた、信じられないほど大きな円柱に、象くらいある蟋蟀が一匹とまっている。クソデカ羅生門が、大河のように広い朱雀大路にある以上は、この狂った男のほかにも、激・雨やみをする巨大市女笠や爆裂揉烏帽子が、もう二三百人はありそうなものである。それが、この珍妙男のほかには全然誰もマジで全くいない。`;
const TEXT = RAW.replace(/[\n\r　 ]+/g, '');

const backend = new VoicevoxBackend({ koffi, path, fs, circuitBreaker: null });
backend.init(path.join(__dirname, '..', 'voicevox_core'), ['0.vvm', '8.vvm'], { gpuMode: false });
const orchestrator = new TtsOrchestrator({ speechBackend: backend });
const chunks = orchestrator.segment(TEXT);

function measure(emotion) {
  const tone = emotion ? toneFor(emotion) : null;
  let dur = 0;
  let pause = 0;
  let pad = 0;
  const spreads = [];
  const meanStds = [];
  for (const chunk of chunks) {
    const q = backend.audioQuery(chunk, VOICE);
    if (tone) {
      if (tone.prePhonemeLength != null) q.prePhonemeLength = tone.prePhonemeLength;
      if (tone.postPhonemeLength != null) q.postPhonemeLength = tone.postPhonemeLength;
      shape(q, tone);
      applyNarration(q);
    }
    const f = analyze(q);
    dur += f.durationSec;
    pause += f.pauseTotalSec;
    pad += ((q.prePhonemeLength || 0) + (q.postPhonemeLength || 0)) / (q.speedScale || 1);
    spreads.push(f.phraseStdSpread);
    meanStds.push(f.phraseMeanStd);
  }
  const silence = pause + pad;
  const avg = (xs) => xs.reduce((a, b) => a + b, 0) / xs.length;
  return {
    chunks: chunks.length, dur, pause, pad,
    silencePct: (100 * silence) / dur,
    avgSpread: avg(spreads),
    avgMeanStd: avg(meanStds)
  };
}

for (const emotion of [null, 'calm', 'excited']) {
  const m = measure(emotion);
  console.log(`${(emotion || '中性').padEnd(8)} 块=${m.chunks} 总时长=${m.dur.toFixed(1)}s 静音占比=${m.silencePct.toFixed(1)}% 逐句起伏落差=${m.avgSpread.toFixed(3)} 逐句均音高落差=${m.avgMeanStd.toFixed(3)}`);
}
backend.dispose();
