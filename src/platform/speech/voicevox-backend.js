// audience: internal
// # voicevox-backend
// SpeechBackend 的 VOICEVOX 实现:FFI 内存、目录结构、版本号、WAV 头全收在此。
// 不变量:VOICEVOX 的 FFI 句柄与原生内存生命周期只在本文件管理,不外泄。

class VoicevoxBackend {
  // 经 VOICEVOX FFI 把文本合成为音频数据。
  synthesize(text, options) {
    throw new Error('未实现,见目标架构设计第七节迁移里程碑');
  }

  // 释放 FFI 句柄与原生内存。
  dispose() {
    throw new Error('未实现,见目标架构设计第七节迁移里程碑');
  }
}

module.exports = { VoicevoxBackend };
