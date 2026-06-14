// audience: internal
// # tts-phrase-dump
// 逐句韵律取证:打印一段含句号、逗号、问号的文本里每个重音短语的均音高、末音高、停顿、疑问标记、音节数,
// 用于核实 VOICEVOX 本身是否做音高下倾、句号与逗号停顿是否可区分,据此设计专业朗读调型。
// 运行:node tools/tts-phrase-dump.js

const path = require('path');
const fs = require('fs');
const koffi = require('koffi');
const { VoicevoxBackend } = require('../src/platform/speech/voicevox-backend');

const backend = new VoicevoxBackend({ koffi, path, fs, circuitBreaker: null });
backend.init(path.join(__dirname, '..', 'voicevox_core'), ['0.vvm', '8.vvm'], { gpuMode: false });

const TEXT = '今日はいい天気だね。だから、外に散歩に行こうと思うんだ。君も一緒にどうかな?それはとても楽しいよ。';
const query = backend.audioQuery(TEXT, 2);
console.log(`accent_phrases=${query.accent_phrases.length}`);
query.accent_phrases.forEach((ph, i) => {
  const voiced = (ph.moras || []).filter((m) => m.pitch > 0);
  const mean = voiced.length ? voiced.reduce((a, b) => a + b.pitch, 0) / voiced.length : 0;
  const last = voiced.length ? voiced[voiced.length - 1].pitch : 0;
  const pause = ph.pause_mora ? ph.pause_mora.vowel_length : 0;
  console.log(`#${String(i).padStart(2)} 均=${mean.toFixed(2)} 末=${last.toFixed(2)} 停顿=${pause.toFixed(3)} 疑问=${ph.is_interrogative ? 'Y' : 'n'} 音节=${(ph.moras || []).length}`);
});
backend.dispose();
