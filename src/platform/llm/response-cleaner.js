// audience: internal
// # response-cleaner
// 把特定模型的输出怪癖(如 think 标签)剥离在这一处,客户端其余部分不感知。
// 不变量:只清理文本怪癖,不改变语义内容,不依赖任何供应商类型。

//// 剥离 think 标签并归并多余空行,返回干净文本 [@x380kkm 2026-06-13] ////
function cleanResponse(rawText) {
  if (!rawText) return rawText;
  return rawText
    .replace(/<think>[\s\S]*?<\/think>/gi, '')
    .replace(/<thinking>[\s\S]*?<\/thinking>/gi, '')
    // 未闭合的 think 标签:从开标签一直删到文本末尾
    .replace(/<think>[\s\S]*$/gi, '')
    .replace(/<thinking>[\s\S]*$/gi, '')
    .replace(/\n\s*\n\s*\n/g, '\n\n')
    .trim();
}

module.exports = { cleanResponse };
