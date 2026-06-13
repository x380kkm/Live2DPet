// audience: internal
// # vendor-profiles
// 供应商兼容预设:把「与供应商无关的请求」翻译成各家协议的请求体、鉴权头、端点路径与响应解析。
// 不变量:每个预设是该供应商协议的唯一包装,供应商差异止于本文件;新增供应商只加一个预设。
//
// 一个预设形如 { name, path, authHeaders(apiKey), buildBody(request, params, isStream), parseComplete(data), parseDelta(parsed) }。
// params 是 step-model-config 解析出的扁平参数 { model, temperature, maxTokens, effort, thinking, extraBody }。
// parseComplete 返回 { text, toolCalls } 的原始文本(清理交客户端);parseDelta 返回 { text, toolCalls, done }。
// effort 映射到各家的推理强度字段;thinking 为 false 时映射到「关闭思考」的供应商写法,为对象时原样透传。

//// 把请求里的覆盖值与解析出的默认值取并:请求级优先 [@busybee 2026-06-13] ////
function pick(request, params, key) {
  return request[key] !== undefined ? request[key] : params[key];
}

//// 从消息序列里抽出系统段与非系统段,供需要分离 system 的协议用 [@busybee 2026-06-13] ////
function splitSystem(messages) {
  const system = [];
  const rest = [];
  for (const m of messages || []) {
    if (m.role === 'system') {
      system.push(m.content);
    } else {
      rest.push(m);
    }
  }
  return { system: system.join('\n\n'), rest };
}

// openai chat completions:现役默认形态,deepseek 与多模型 API 站均兼容。
const openaiChat = {
  name: 'openai-chat',
  path: '/chat/completions',
  authHeaders(apiKey) {
    return { Authorization: `Bearer ${apiKey}` };
  },
  buildBody(request, params, isStream) {
    const body = {
      model: params.model,
      messages: request.messages,
      max_tokens: pick(request, params, 'maxTokens'),
      temperature: pick(request, params, 'temperature')
    };
    if (request.tools) body.tools = request.tools;
    if (isStream) body.stream = true;
    const effort = pick(request, params, 'effort');
    if (effort !== undefined) body.reasoning_effort = effort;
    const thinking = pick(request, params, 'thinking');
    // 思考默认开,关闭走供应商「禁用思考」写法;对象则原样透传,布尔真不发(已是默认)。
    if (thinking === false) body.thinking = { type: 'disabled' };
    else if (thinking && typeof thinking === 'object') body.thinking = thinking;
    Object.assign(body, params.extraBody || {});
    return body;
  },
  parseComplete(data) {
    if (!data.choices || !data.choices[0]) {
      throw new Error('LLM 响应为空');
    }
    const message = data.choices[0].message || {};
    return { text: message.content || '', toolCalls: message.tool_calls || [] };
  },
  parseDelta(parsed) {
    const delta = (parsed.choices && parsed.choices[0] && parsed.choices[0].delta) || {};
    return { text: delta.content || '', toolCalls: delta.tool_calls || [], done: false };
  }
};

// Anthropic claude messages:system 单列,鉴权用 x-api-key,响应在 content 数组里。
const claude = {
  name: 'claude',
  path: '/v1/messages',
  authHeaders(apiKey) {
    return { 'x-api-key': apiKey, 'anthropic-version': '2023-06-01' };
  },
  buildBody(request, params, isStream) {
    const { system, rest } = splitSystem(request.messages);
    const body = {
      model: params.model,
      max_tokens: pick(request, params, 'maxTokens'),
      temperature: pick(request, params, 'temperature'),
      messages: rest.map((m) => ({ role: m.role, content: m.content }))
    };
    if (system) body.system = system;
    if (request.tools) body.tools = request.tools;
    if (isStream) body.stream = true;
    const thinking = pick(request, params, 'thinking');
    // claude 的扩展思考用对象 { type:'enabled', budget_tokens };布尔真不发。
    if (thinking && typeof thinking === 'object') body.thinking = thinking;
    Object.assign(body, params.extraBody || {});
    return body;
  },
  parseComplete(data) {
    const blocks = Array.isArray(data.content) ? data.content : [];
    const text = blocks.filter((b) => b.type === 'text').map((b) => b.text).join('');
    const toolCalls = blocks.filter((b) => b.type === 'tool_use');
    if (!text && toolCalls.length === 0 && !data.stop_reason) {
      throw new Error('LLM 响应为空');
    }
    return { text, toolCalls };
  },
  parseDelta(parsed) {
    if (parsed.type === 'content_block_delta' && parsed.delta) {
      return { text: parsed.delta.text || '', toolCalls: [], done: false };
    }
    if (parsed.type === 'message_stop') {
      return { text: '', toolCalls: [], done: true };
    }
    return { text: '', toolCalls: [], done: false };
  }
};

// openai responses:用 input 与 instructions 取代 messages,推理强度走 reasoning.effort。
const openaiResponses = {
  name: 'openai-responses',
  path: '/responses',
  authHeaders(apiKey) {
    return { Authorization: `Bearer ${apiKey}` };
  },
  buildBody(request, params, isStream) {
    const { system, rest } = splitSystem(request.messages);
    const body = {
      model: params.model,
      input: rest.map((m) => ({
        role: m.role,
        content: [{ type: m.role === 'assistant' ? 'output_text' : 'input_text', text: m.content }]
      })),
      max_output_tokens: pick(request, params, 'maxTokens'),
      temperature: pick(request, params, 'temperature')
    };
    if (system) body.instructions = system;
    if (request.tools) body.tools = request.tools;
    if (isStream) body.stream = true;
    const effort = pick(request, params, 'effort');
    if (effort !== undefined) body.reasoning = { effort };
    Object.assign(body, params.extraBody || {});
    return body;
  },
  parseComplete(data) {
    // 优先用便捷字段 output_text,否则从 output 数组里拼 output_text 块。
    if (typeof data.output_text === 'string' && data.output_text.length > 0) {
      return { text: data.output_text, toolCalls: [] };
    }
    const items = Array.isArray(data.output) ? data.output : [];
    let text = '';
    const toolCalls = [];
    for (const item of items) {
      if (item.type === 'message' && Array.isArray(item.content)) {
        text += item.content.filter((c) => c.type === 'output_text').map((c) => c.text).join('');
      } else if (item.type === 'function_call' || item.type === 'tool_call') {
        toolCalls.push(item);
      }
    }
    if (!text && toolCalls.length === 0) {
      throw new Error('LLM 响应为空');
    }
    return { text, toolCalls };
  },
  parseDelta(parsed) {
    if (parsed.type === 'response.output_text.delta') {
      return { text: parsed.delta || '', toolCalls: [], done: false };
    }
    if (parsed.type === 'response.completed') {
      return { text: '', toolCalls: [], done: true };
    }
    return { text: '', toolCalls: [], done: false };
  }
};

const PROFILES = { 'openai-chat': openaiChat, claude, 'openai-responses': openaiResponses };

//// 按预设名取供应商预设,未知预设回退到 openai-chat [@busybee 2026-06-13] ////
function profileFor(preset) {
  return PROFILES[preset] || openaiChat;
}

module.exports = { PROFILES, profileFor, openaiChat, claude, openaiResponses };
