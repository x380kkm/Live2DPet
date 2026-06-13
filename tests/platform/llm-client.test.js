// 运行:node --test tests/platform/llm-client.test.js
const { test } = require('node:test');
const assert = require('node:assert');
const { LlmClient } = require('../../src/platform/llm/llm-client');

// 构造一个返回固定 JSON 的非流式响应桩
function jsonResponse(data, ok = true, status = 200) {
  return {
    ok,
    status,
    json: async () => data,
    text: async () => JSON.stringify(data)
  };
}

// 构造一个把若干 SSE 文本块依次吐出的流式响应桩
function sseResponse(chunks) {
  const encoder = new TextEncoder();
  let index = 0;
  return {
    ok: true,
    status: 200,
    body: {
      getReader() {
        return {
          read: async () => {
            if (index < chunks.length) {
              return { value: encoder.encode(chunks[index++]), done: false };
            }
            return { value: undefined, done: true };
          },
          releaseLock() {}
        };
      }
    }
  };
}

const baseConfig = { apiKey: 'k', baseURL: 'https://api.test/v1', model: 'm' };
const passthroughCleaner = (text) => text;
const noopSleep = async () => {};

test('complete 组装供应商请求体并带上鉴权头与 tools', async () => {
  let captured;
  const client = new LlmClient(baseConfig, {
    fetch: async (url, options) => {
      captured = { url, options };
      return jsonResponse({ choices: [{ message: { content: 'hi' } }] });
    },
    cleanResponse: passthroughCleaner,
    sleep: noopSleep
  });

  const tools = [{ type: 'function', function: { name: 'f' } }];
  await client.complete({ messages: [{ role: 'user', content: 'q' }], tools });

  assert.strictEqual(captured.url, 'https://api.test/v1/chat/completions');
  assert.strictEqual(captured.options.headers['Authorization'], 'Bearer k');
  const body = JSON.parse(captured.options.body);
  assert.strictEqual(body.model, 'm');
  assert.deepStrictEqual(body.messages, [{ role: 'user', content: 'q' }]);
  assert.deepStrictEqual(body.tools, tools);
  assert.ok(!('stream' in body));
});

test('complete 经清理器返回文本并透出工具调用与原始数据', async () => {
  const raw = {
    choices: [{ message: { content: '<think>x</think>答案', tool_calls: [{ id: '1' }] } }]
  };
  const client = new LlmClient(baseConfig, {
    fetch: async () => jsonResponse(raw),
    cleanResponse: (text) => text.replace('<think>x</think>', ''),
    sleep: noopSleep
  });

  const result = await client.complete({ messages: [] });
  assert.strictEqual(result.text, '答案');
  assert.deepStrictEqual(result.toolCalls, [{ id: '1' }]);
  assert.strictEqual(result.raw, raw);
});

test('complete 把 AbortError 译为超时错误', async () => {
  const client = new LlmClient(baseConfig, {
    fetch: async () => {
      const err = new Error('aborted');
      err.name = 'AbortError';
      throw err;
    },
    cleanResponse: passthroughCleaner,
    sleep: noopSleep
  });

  await assert.rejects(client.complete({ messages: [] }), /超时/);
});

test('complete 在失败后按 maxRetries 重试,最终成功', async () => {
  let calls = 0;
  let slept = 0;
  const client = new LlmClient(
    { ...baseConfig, maxRetries: 2 },
    {
      fetch: async () => {
        calls++;
        if (calls < 3) throw new Error('网络抖动');
        return jsonResponse({ choices: [{ message: { content: 'ok' } }] });
      },
      cleanResponse: passthroughCleaner,
      sleep: async () => { slept++; }
    }
  );

  const result = await client.complete({ messages: [] });
  assert.strictEqual(result.text, 'ok');
  assert.strictEqual(calls, 3);
  assert.strictEqual(slept, 2);
});

test('complete 耗尽重试后抛出最后一次错误', async () => {
  const client = new LlmClient(
    { ...baseConfig, maxRetries: 1 },
    {
      fetch: async () => { throw new Error('一直失败'); },
      cleanResponse: passthroughCleaner,
      sleep: noopSleep
    }
  );

  await assert.rejects(client.complete({ messages: [] }), /一直失败/);
});

test('非 ok 响应抛出含状态码的错误', async () => {
  const client = new LlmClient(baseConfig, {
    fetch: async () => jsonResponse({ error: 'bad' }, false, 401),
    cleanResponse: passthroughCleaner,
    sleep: noopSleep
  });

  await assert.rejects(client.complete({ messages: [] }), /401/);
});

test('stream 请求体带上 stream 标志', async () => {
  let captured;
  const client = new LlmClient(baseConfig, {
    fetch: async (url, options) => {
      captured = JSON.parse(options.body);
      return sseResponse(['data: [DONE]\n']);
    },
    cleanResponse: passthroughCleaner,
    sleep: noopSleep
  });

  // 取尽迭代器以触发请求
  for await (const _ of client.stream({ messages: [] })) { void _; }
  assert.strictEqual(captured.stream, true);
});

test('stream 逐块产出文本增量并以 done 收尾', async () => {
  const client = new LlmClient(baseConfig, {
    fetch: async () => sseResponse([
      'data: {"choices":[{"delta":{"content":"你"}}]}\n',
      'data: {"choices":[{"delta":{"content":"好"}}]}\n',
      'data: [DONE]\n'
    ]),
    cleanResponse: passthroughCleaner,
    sleep: noopSleep
  });

  const deltas = [];
  for await (const delta of client.stream({ messages: [] })) {
    deltas.push(delta);
  }

  assert.strictEqual(deltas.length, 3);
  assert.strictEqual(deltas[0].text, '你');
  assert.strictEqual(deltas[1].text, '好');
  assert.strictEqual(deltas[2].done, true);
});

test('stream 跨网络分片重组被截断的 data 行', async () => {
  const client = new LlmClient(baseConfig, {
    fetch: async () => sseResponse([
      'data: {"choices":[{"delta":{"con',
      'tent":"拼接"}}]}\n',
      'data: [DONE]\n'
    ]),
    cleanResponse: passthroughCleaner,
    sleep: noopSleep
  });

  const texts = [];
  for await (const delta of client.stream({ messages: [] })) {
    if (delta.text) texts.push(delta.text);
  }
  assert.deepStrictEqual(texts, ['拼接']);
});
