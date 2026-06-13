// audience: internal
// # speech
// 发言数据单元:文本、情绪、音频对齐三者的承载结构。
// 不变量:发言是平直数据,无行为副作用;会话用显式取消令牌表达取消,不依赖全局静态计数器。

class Utterance {
  // 发言文本
  text = '';
  // 关联情绪
  emotion = null;
  // 音频对齐信息
  audioAlignment = null;
}

module.exports = { Utterance };
