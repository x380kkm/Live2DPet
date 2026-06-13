// 运行:node --test tests/platform/vendor-profiles.test.js
// 验证三套供应商预设的请求体、鉴权头、响应解析与 effort/thinking 映射。
const { test } = require('node:test');
const assert = require('node:assert');
const { profileFor, openaiChat, claude, openaiResponses } = require('../../src/platform/llm/vendor-profiles');

const params = { model: 'm', temperature: 1.3, maxTokens: 200, extraBody: {} };
const req = { messages: [{ role: 'system', content: 'sys' }, { role: 'user', content: 'hi' }] };

test('未知预设回退到 openai-chat', () => {
  assert.strictEqual(profileFor('nope'), openaiChat);
  assert.strictEqual(profileFor('claude'), claude);
});

test('openai-chat:Bearer 鉴权、messages 原样、温度与 token 落位', () => {
  assert.deepStrictEqual(openaiChat.authHeaders('k'), { Authorization: 'Bearer k' });
  const body = openaiChat.buildBody(req, params, false);
  assert.strictEqual(body.model, 'm');
  assert.deepStrictEqual(body.messages, req.messages);
  assert.strictEqual(body.temperature, 1.3);
  assert.strictEqual(body.max_tokens, 200);
  assert.ok(!('stream' in body));
});

test('openai-chat:effort 映射 reasoning_effort,thinking=false 映射禁用思考', () => {
  const body = openaiChat.buildBody(req, { ...params, effort: 'high', thinking: false }, false);
  assert.strictEqual(body.reasoning_effort, 'high');
  assert.deepStrictEqual(body.thinking, { type: 'disabled' });
});

test('openai-chat:thinking=true 不发字段(已是默认开)', () => {
  const body = openaiChat.buildBody(req, { ...params, thinking: true }, false);
  assert.ok(!('thinking' in body));
});

test('openai-chat:请求级温度覆盖默认,extraBody 合并', () => {
  const body = openaiChat.buildBody({ ...req, temperature: 0 }, { ...params, extraBody: { top_p: 0.8 } }, false);
  assert.strictEqual(body.temperature, 0);
  assert.strictEqual(body.top_p, 0.8);
});

test('openai-chat:解析 choices 文本与工具调用,空响应报错', () => {
  const r = openaiChat.parseComplete({ choices: [{ message: { content: '答', tool_calls: [{ id: '1' }] } }] });
  assert.strictEqual(r.text, '答');
  assert.deepStrictEqual(r.toolCalls, [{ id: '1' }]);
  assert.throws(() => openaiChat.parseComplete({}), /响应为空/);
});

test('claude:x-api-key 鉴权、system 单列、messages 去掉 system', () => {
  assert.deepStrictEqual(claude.authHeaders('k'), { 'x-api-key': 'k', 'anthropic-version': '2023-06-01' });
  const body = claude.buildBody(req, params, false);
  assert.strictEqual(body.system, 'sys');
  assert.deepStrictEqual(body.messages, [{ role: 'user', content: 'hi' }]);
  assert.strictEqual(body.max_tokens, 200);
});

test('claude:解析 content 数组里的文本块', () => {
  const r = claude.parseComplete({ content: [{ type: 'text', text: '你' }, { type: 'text', text: '好' }], stop_reason: 'end_turn' });
  assert.strictEqual(r.text, '你好');
});

test('claude:增量解析 content_block_delta 与 message_stop', () => {
  assert.strictEqual(claude.parseDelta({ type: 'content_block_delta', delta: { text: 'x' } }).text, 'x');
  assert.strictEqual(claude.parseDelta({ type: 'message_stop' }).done, true);
});

test('openai-responses:input 与 instructions、effort 映射 reasoning.effort', () => {
  const body = openaiResponses.buildBody(req, { ...params, effort: 'low' }, false);
  assert.strictEqual(body.instructions, 'sys');
  assert.strictEqual(body.input[0].role, 'user');
  assert.strictEqual(body.input[0].content[0].type, 'input_text');
  assert.strictEqual(body.max_output_tokens, 200);
  assert.deepStrictEqual(body.reasoning, { effort: 'low' });
});

test('openai-responses:优先用 output_text,否则拼 output 数组', () => {
  assert.strictEqual(openaiResponses.parseComplete({ output_text: '便捷' }).text, '便捷');
  const r = openaiResponses.parseComplete({ output: [{ type: 'message', content: [{ type: 'output_text', text: '拼' }] }] });
  assert.strictEqual(r.text, '拼');
});
