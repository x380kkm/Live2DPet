// audience: internal
// # tts-orchestrator
// TTS 编排:分句、调度、与发言对齐,经 SpeechBackend 合成。
// 不变量:与具体语音后端无关,只依赖 SpeechBackend 接口;不含后端实现细节。

const UNIMPLEMENTED = '未实现,见目标架构设计第七节迁移里程碑';

class TtsOrchestrator {
  // utterance 为发言单元,合成并与之对齐
  synthesize(utterance) {
    throw new Error(UNIMPLEMENTED);
  }

  // 把文本分句以供逐句调度
  segment(text) {
    throw new Error(UNIMPLEMENTED);
  }
}

module.exports = { TtsOrchestrator };
