// audience: internal
// # speech
// 语音后端适配层的公共接口:SpeechBackend 文本进、音频出,后端可替换。
// 不变量:对外不暴露任何具体合成引擎的类型;VOICEVOX 的 FFI 内存、目录结构、版本号与 WAV 格式只在 voicevox-backend 一处。

class SpeechBackend {
  // 把文本合成为音频数据。
  synthesize(text, options) {
    throw new Error('未实现,见目标架构设计第七节迁移里程碑');
  }

  // 释放后端资源。
  dispose() {
    throw new Error('未实现,见目标架构设计第七节迁移里程碑');
  }
}

module.exports = { SpeechBackend };
