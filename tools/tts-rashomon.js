// audience: internal
// # tts-rashomon
// 长文本试听:用一段连续叙事(クソデカ羅生門)走真实合成路径(编排器分句、逐句塑形加增益、拼接),
// 合成基线、平静、兴奋三版,检验长文本下平直占主体、锚点突出是否成立。
// 运行:node tools/tts-rashomon.js

const path = require('path');
const fs = require('fs');
const koffi = require('koffi');
const { VoicevoxBackend } = require('../src/platform/speech/voicevox-backend');
const { TtsOrchestrator } = require('../src/domain/tts/tts-orchestrator');
const { Utterance } = require('../src/domain/speech/utterance');
const { toneFor } = require('../src/domain/tts/tone-map');
const { apply } = require('../src/domain/tts/prosody-shaper');

const VOICE = 2;
const RAW = `ある日の超暮方(ほぼ夜)の事である。一人の下人が、クソデカい羅生門の完全な真下で雨やみを気持ち悪いほどずっと待ちまくっていた。
馬鹿みたいに広い門の真下には、この大男のほかに全然誰もいない。ただ、所々丹塗のびっくりするくらい剥げた、信じられないほど大きな円柱に、象くらいある蟋蟀が一匹とまっている。クソデカ羅生門が、大河のように広い朱雀大路にある以上は、この狂った男のほかにも、激・雨やみをする巨大市女笠や爆裂揉烏帽子が、もう二三百人はありそうなものである。それが、この珍妙男のほかには全然誰もマジで全くいない。
何故かと云うと、この二三千年、京都には、超巨大地震とか破壊的辻風とか最強大火事とか極限饑饉とか云うエグすぎる災が毎日つづいて起こった。そこでクソ広い洛中のさびれ方はマジでもう一通りとかそういうレベルではない。`;
// 去掉换行与缩进空白,保留句末标点驱动分句。
const TEXT = RAW.replace(/[\n\r　 ]+/g, '');

const VARIANTS = [
  { key: 'rashomon-off', emotion: null },
  { key: 'rashomon-calm', emotion: 'calm' },
  { key: 'rashomon-excited', emotion: 'excited' }
];

const outDir = path.join(__dirname, 'samples');
fs.mkdirSync(outDir, { recursive: true });

const backend = new VoicevoxBackend({ koffi, path, fs, circuitBreaker: null, prosodyShaper: apply });
backend.init(path.join(__dirname, '..', 'voicevox_core'), ['0.vvm', '8.vvm'], { gpuMode: false });
backend.setConfig({ styleId: VOICE });
backend.warmup();

const orchestrator = new TtsOrchestrator({ speechBackend: backend });

for (const v of VARIANTS) {
  const utterance = Utterance.of(TEXT);
  orchestrator.synthesize(utterance, v.emotion ? { tone: toneFor(v.emotion) } : {});
  if (!utterance.hasAudio()) {
    console.log(`${v.key} 无音频`);
    continue;
  }
  const wav = utterance.audioAlignment.audio;
  fs.writeFileSync(path.join(outDir, `${v.key}.wav`), wav);
  console.log(`${v.key} 情绪=${v.emotion || '无'} ${wav.length}字节`);
}
backend.dispose();
