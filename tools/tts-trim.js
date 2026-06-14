// audience: internal
// # tts-trim
// 把一个 WAV 从头裁到指定秒数,改小文件以便聊天投递。保留头部、截断 PCM、回写长度字段。
// 运行:node tools/tts-trim.js <源文件名> <目标文件名> <秒数>

const fs = require('fs');
const path = require('path');

const [srcName, dstName, secArg] = process.argv.slice(2);
const seconds = Number(secArg) || 55;
const dir = path.join(__dirname, 'samples');
const wav = fs.readFileSync(path.join(dir, srcName || 'rashomon-full-calm.wav'));

const sampleRate = wav.readUInt32LE(24);
const numChannels = wav.readUInt16LE(22);
const frameBytes = numChannels * 2;
const keepFrames = Math.min(Math.floor((wav.length - 44) / frameBytes), Math.floor(seconds * sampleRate));
const pcmBytes = keepFrames * frameBytes;

const out = Buffer.alloc(44 + pcmBytes);
wav.copy(out, 0, 0, 44);
wav.copy(out, 44, 44, 44 + pcmBytes);
out.writeUInt32LE(36 + pcmBytes, 4);
out.writeUInt32LE(pcmBytes, 40);

// 末尾约 40 毫秒淡出,避免裁切处的突兀尾音。
const fadeFrames = Math.min(keepFrames, Math.floor(sampleRate * 0.04));
for (let i = 0; i < fadeFrames; i++) {
  const frame = keepFrames - fadeFrames + i;
  const gain = (fadeFrames - i) / fadeFrames;
  for (let c = 0; c < numChannels; c++) {
    const o = 44 + frame * frameBytes + c * 2;
    out.writeInt16LE(Math.round(out.readInt16LE(o) * gain), o);
  }
}

const dstPath = path.join(dir, dstName || 'rashomon-share.wav');
fs.writeFileSync(dstPath, out);
console.log(`${dstPath} ${(out.length / 1048576).toFixed(2)}MB 约 ${(pcmBytes / (sampleRate * frameBytes)).toFixed(0)} 秒`);
