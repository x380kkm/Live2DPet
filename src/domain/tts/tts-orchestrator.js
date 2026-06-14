// audience: internal
// # tts-orchestrator
// TTS 编排:分句、调度、与发言对齐,经 SpeechBackend 合成。
// 不变量:与具体语音后端无关,只依赖 SpeechBackend 接口;不含后端实现细节。
// 构造注入:speechBackend(文本进音频出)与可选 maxChunkLen(分句上限)从外部传入,本文件不直接抓全局。

const { Utterance } = require('../speech/utterance');

// 分句的默认最大长度,超过才分,短句合并到此长度上限
const DEFAULT_MAX_CHUNK_LEN = 80;
// WAV 头长度:标准 44 字节
const WAV_HEADER_BYTES = 44;
// WAV 头里采样字节率字段的偏移,据它把 PCM 字节数换算成时长
const WAV_BYTE_RATE_OFFSET = 28;
// WAV 头里声道数、采样率、位深字段的偏移,用于拼接时重写头
const WAV_NUM_CHANNELS_OFFSET = 22;
const WAV_SAMPLE_RATE_OFFSET = 24;
const WAV_BITS_PER_SAMPLE_OFFSET = 34;
// 在句末标点后切句:连续的句末标点与其后的装饰符算作一段
const SENTENCE_BOUNDARY = /[。！？]+[…♡♪～☆]*/g;

//// 把文本分句、逐句经后端合成、拼接对齐到发言的编排器 [@busybee 2026-06-13] ////
class TtsOrchestrator {
  constructor({ speechBackend, maxChunkLen = DEFAULT_MAX_CHUNK_LEN } = {}) {
    this.speechBackend = speechBackend;
    this.maxChunkLen = maxChunkLen;
  }

  //// 把发言文本逐句合成、拼接、算时长,回填到发言的音频对齐字段 [@busybee 2026-06-13] ////
  synthesize(utterance, options = {}) {
    if (!this.speechBackend) return utterance;
    const chunks = this.segment(utterance.text);
    const tone = options.tone || null;
    const wavBuffers = [];
    for (const chunk of chunks) {
      const wav = tone ? this.speechBackend.synthesize(chunk, { tone }) : this.speechBackend.synthesize(chunk);
      if (wav) wavBuffers.push(wav);
    }
    if (wavBuffers.length === 0) return utterance;

    const combined = concatWavBuffers(wavBuffers);
    const durationMs = wavDurationMs(combined);
    utterance.audioAlignment = Utterance.alignTo(combined, durationMs);
    return utterance;
  }

  //// 在句末标点后分句,过短的相邻段合并到长度上限以内 [@busybee 2026-06-13] ////
  segment(text) {
    const maxLen = this.maxChunkLen;
    if (!text || text.length <= maxLen) return [text];

    const parts = [];
    let last = 0;
    let match;
    SENTENCE_BOUNDARY.lastIndex = 0;
    while ((match = SENTENCE_BOUNDARY.exec(text)) !== null) {
      const end = match.index + match[0].length;
      parts.push(text.slice(last, end));
      last = end;
    }
    if (last < text.length) parts.push(text.slice(last));

    const chunks = [];
    let buffer = '';
    for (const segment of parts) {
      if (buffer.length + segment.length > maxLen && buffer.length > 0) {
        chunks.push(buffer);
        buffer = '';
      }
      buffer += segment;
    }
    if (buffer) chunks.push(buffer);
    return chunks;
  }
  //// /在句末标点后分句 ////
}

//// 把同格式的多个 WAV 缓冲合成一个:去头、并 PCM、重写头 [@busybee 2026-06-13] ////
function concatWavBuffers(buffers) {
  if (buffers.length === 0) return null;
  if (buffers.length === 1) return buffers[0];

  // 格式参数从第一个缓冲的头里读出,各缓冲假定同格式
  const header = buffers[0];
  const numChannels = header.readUInt16LE(WAV_NUM_CHANNELS_OFFSET);
  const sampleRate = header.readUInt32LE(WAV_SAMPLE_RATE_OFFSET);
  const bitsPerSample = header.readUInt16LE(WAV_BITS_PER_SAMPLE_OFFSET);
  const blockAlign = numChannels * (bitsPerSample / 8);
  const byteRate = sampleRate * blockAlign;

  const pcmParts = buffers.map((b) => b.slice(WAV_HEADER_BYTES));
  const totalPcmLen = pcmParts.reduce((sum, p) => sum + p.length, 0);

  const out = Buffer.alloc(WAV_HEADER_BYTES + totalPcmLen);
  out.write('RIFF', 0);
  out.writeUInt32LE(36 + totalPcmLen, 4);
  out.write('WAVE', 8);
  out.write('fmt ', 12);
  // fmt 块大小恒为 16
  out.writeUInt32LE(16, 16);
  // 音频格式 1 表示 PCM
  out.writeUInt16LE(1, 20);
  out.writeUInt16LE(numChannels, WAV_NUM_CHANNELS_OFFSET);
  out.writeUInt32LE(sampleRate, WAV_SAMPLE_RATE_OFFSET);
  out.writeUInt32LE(byteRate, WAV_BYTE_RATE_OFFSET);
  out.writeUInt16LE(blockAlign, 32);
  out.writeUInt16LE(bitsPerSample, WAV_BITS_PER_SAMPLE_OFFSET);
  out.write('data', 36);
  out.writeUInt32LE(totalPcmLen, 40);

  let offset = WAV_HEADER_BYTES;
  for (const pcm of pcmParts) {
    pcm.copy(out, offset);
    offset += pcm.length;
  }
  return out;
}
//// /把同格式的多个 WAV 缓冲合成一个 ////

//// 按 WAV 头的字节率把 PCM 字节数换算成毫秒时长 [@busybee 2026-06-13] ////
function wavDurationMs(buffer) {
  if (!buffer || buffer.length <= WAV_HEADER_BYTES) return 0;
  const byteRate = buffer.readUInt32LE(WAV_BYTE_RATE_OFFSET);
  if (!byteRate) return 0;
  const pcmLen = buffer.length - WAV_HEADER_BYTES;
  return (pcmLen / byteRate) * 1000;
}

module.exports = { TtsOrchestrator, concatWavBuffers, wavDurationMs };
