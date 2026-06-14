// audience: internal
// # tts-metas
// 打印当前加载模型的说话人与样式元数据,供挑选情绪声线参考。
// 运行:node tools/tts-metas.js

const path = require('path');
const fs = require('fs');
const koffi = require('koffi');
const { VoicevoxBackend } = require('../src/platform/speech/voicevox-backend');

const backend = new VoicevoxBackend({ koffi, path, fs, circuitBreaker: null });
backend.init(path.join(__dirname, '..', 'voicevox_core'), ['0.vvm', '8.vvm'], { gpuMode: false });
for (const speaker of backend.getMetas()) {
  const styles = (speaker.styles || []).map((s) => `${s.id}:${s.name}`).join(', ');
  console.log(`${speaker.name} -> ${styles}`);
}
backend.dispose();
