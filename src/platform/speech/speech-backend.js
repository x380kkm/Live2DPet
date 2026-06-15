// audience: internal
// # speech-backend
// 语音后端适配层的公共接口:SpeechBackend 文本进、音频出,后端可替换。
// 不变量:对外不暴露任何具体合成引擎的类型;VOICEVOX 的 FFI 内存、目录结构、版本号与 WAV 格式只在 voicevox-backend 一处。

//// 声明文本进音频出的抽象接口,具体后端实现这两个方法 [@x380kkm 2026-06-13] ////
class SpeechBackend {
  //// 把文本合成为音频数据,子类必须重写 [@x380kkm 2026-06-13] ////
  synthesize(text, options) {
    throw new Error('SpeechBackend.synthesize 是抽象方法,需由具体后端实现');
  }

  //// 释放后端资源,子类必须重写 [@x380kkm 2026-06-13] ////
  dispose() {
    throw new Error('SpeechBackend.dispose 是抽象方法,需由具体后端实现');
  }
}

module.exports = { SpeechBackend };
