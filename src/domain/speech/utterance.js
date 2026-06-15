// audience: internal
// # utterance
// 发言数据单元:文本、情绪、音频对齐三者的承载结构。
// 不变量:发言是平直数据,无行为副作用;会话用显式取消令牌表达取消,不依赖全局静态计数器。

// 音频时长之外多给气泡留的余量,使气泡晚于声音消失
const AUDIO_BUBBLE_BUFFER_MS = 800;
// 没有音频对齐时的默认气泡时长
const DEFAULT_BUBBLE_MS = 8000;
// 即便音频很短也保证的最短气泡时长
const MIN_BUBBLE_MS = 3000;

//// 承载一次发言的文本、情绪与音频对齐数据,不带行为 [@x380kkm 2026-06-13] ////
class Utterance {
  constructor() {
    // 发言文本
    this.text = '';
    // 关联情绪态,缺省无情绪
    this.emotion = null;
    // 音频对齐信息:{ audio, durationMs, bubbleDurationMs },缺省无音频
    this.audioAlignment = null;
  }

  //// 是否有可对齐的音频,即对齐信息存在且时长为正 [@x380kkm 2026-06-13] ////
  hasAudio() {
    return !!(this.audioAlignment && this.audioAlignment.durationMs > 0);
  }

  //// 取气泡显示时长:有音频按音频时长加余量,否则用默认时长 [@x380kkm 2026-06-13] ////
  bubbleDurationMs() {
    if (this.hasAudio()) return this.audioAlignment.bubbleDurationMs;
    return DEFAULT_BUBBLE_MS;
  }

  //// 用文本与情绪构造一条尚无音频的发言 [@x380kkm 2026-06-13] ////
  static of(text, emotion = null) {
    const utterance = new Utterance();
    utterance.text = text;
    utterance.emotion = emotion;
    return utterance;
  }

  //// 从音频与时长算出对齐信息,气泡时长取音频加余量与最短时长的较大者 [@x380kkm 2026-06-13] ////
  static alignTo(audio, durationMs) {
    const bubbleDurationMs = Math.max(durationMs + AUDIO_BUBBLE_BUFFER_MS, MIN_BUBBLE_MS);
    return { audio, durationMs, bubbleDurationMs };
  }
}

module.exports = { Utterance, AUDIO_BUBBLE_BUFFER_MS, DEFAULT_BUBBLE_MS, MIN_BUBBLE_MS };
