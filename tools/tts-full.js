// audience: internal
// # tts-full
// 完整版合成:把完整测试文本(クソデカ羅生門三段)以平静叙事(含专业朗读结构)合成成一个 WAV,存盘供下载分享。
// 运行:node tools/tts-full.js

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
何故かと云うと、この二三千年、京都には、超巨大地震とか破壊的辻風とか最強大火事とか極限饑饉とか云うエグすぎる災が毎日つづいて起こった。そこでクソ広い洛中のさびれ方はマジでもう一通りとかそういうレベルではない。旧記によると、クソデカい仏像や文化財クラスの仏具をものすごいパワーで打砕いて、その丹がベッチャベチャについたり、金銀の箔がもうイヤになっちゃうくらいついたりした木を、路ばたに親の仇のようにメチャメチャつみ重ねて、薪の料に売りまくっていたと云う事である。クソ治安がいいことで知られる洛中がその始末であるから、正気を疑うレベルでデカい羅生門の完全修理などは、元より誰も捨てて顧る者がマジで全然なかった。するとそのドン引きするくらい荒れ果てたのをよい事にして、クソヤバい狐狸がドンドン棲む。世界最強の盗人が6万人棲む。とうとうしまいには、マジで悲しくなっちゃうくらい全然引取り手のないきったない死人を、この門へ猛ダッシュで持って来て、超スピードで棄てて行くと云う習慣さえ出来た。そこで、日の目が怖いくらい全然まったく見えなくなると、誰でもメチャメチャ気味を悪るがって、この門の近所へはマジでビックリするくらい足ぶみをしない事になってしまったのである。`;
const TEXT = RAW.replace(/[\n\r　 ]+/g, '');

const outDir = path.join(__dirname, 'samples');
fs.mkdirSync(outDir, { recursive: true });

const backend = new VoicevoxBackend({ koffi, path, fs, circuitBreaker: null, prosodyShaper: apply });
backend.init(path.join(__dirname, '..', 'voicevox_core'), ['0.vvm', '8.vvm'], { gpuMode: false });
backend.setConfig({ styleId: VOICE });
backend.warmup();
const orchestrator = new TtsOrchestrator({ speechBackend: backend });

const utterance = Utterance.of(TEXT);
orchestrator.synthesize(utterance, { tone: toneFor('calm') });
if (!utterance.hasAudio()) {
  console.log('合成失败');
} else {
  const wav = utterance.audioAlignment.audio;
  const file = path.join(outDir, 'rashomon-full-calm.wav');
  fs.writeFileSync(file, wav);
  const sampleRate = wav.readUInt32LE(24);
  const seconds = (wav.length - 44) / (sampleRate * 2);
  console.log(`完整版已存:${file} ${(wav.length / 1048576).toFixed(2)}MB 约 ${seconds.toFixed(0)} 秒`);
}
backend.dispose();
