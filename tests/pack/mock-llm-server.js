// audience: internal
// # mock-llm-server
// 打包版无人实测用的本地桩 LLM 服务:实现 openai-chat 的 /v1/chat/completions,按系统提示判调用类型回脚本化文本。
// 不变量:只在本机回环监听、随机端口;不联网;按请求里的系统提示粗判选帧、抽态势还是产台词,回对应桩文本。

const http = require('http');

//// 据系统提示粗判调用类型,回对应桩文本 [@x380kkm 2026-06-14] ////
// 选帧请求回首帧索引,抽态势请求回一句态势,选意图请求回空(让决策器回退首候选),其余当作产台词回固定台词。
function scriptedReply(messages, dialogue) {
  const system = (messages || []).find((m) => m.role === 'system');
  const content = (system && system.content) || '';
  if (/选.*帧|关键帧|frame|索引/i.test(content)) {
    return '[0]';
  }
  if (/态势|当前.*场景|situation|在做什么/i.test(content)) {
    return '用户在看代码编辑器';
  }
  if (/只回.*id|选最合适的一个/i.test(content)) {
    return '';
  }
  return dialogue;
}
//// /据系统提示粗判调用类型 ////

//// 起一个本地桩 LLM 服务,回 { url, requests, close } [@x380kkm 2026-06-14] ////
function startMockLlm(options = {}) {
  const dialogue = options.dialogue || 'こんにちは、ちゃんと見てるよ。';
  let requests = 0;
  const server = http.createServer((req, res) => {
    if (req.method !== 'POST') {
      res.writeHead(404);
      res.end();
      return;
    }
    let body = '';
    req.on('data', (chunk) => { body += chunk; });
    req.on('end', () => {
      requests += 1;
      let text = dialogue;
      try {
        const parsed = JSON.parse(body || '{}');
        text = scriptedReply(parsed.messages, dialogue);
      } catch (error) {
        text = dialogue;
      }
      const payload = {
        id: 'mock-completion',
        object: 'chat.completion',
        choices: [{ index: 0, message: { role: 'assistant', content: text }, finish_reason: 'stop' }],
        usage: { prompt_tokens: 0, completion_tokens: 0, total_tokens: 0 }
      };
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify(payload));
    });
  });

  return new Promise((resolve) => {
    server.listen(0, '127.0.0.1', () => {
      const port = server.address().port;
      resolve({
        url: `http://127.0.0.1:${port}/v1`,
        requests: () => requests,
        close: () => new Promise((done) => server.close(done))
      });
    });
  });
}
//// /起一个本地桩 LLM 服务 ////

module.exports = { startMockLlm, scriptedReply };
