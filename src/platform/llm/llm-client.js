// audience: internal
// # llm-client
// 统一 LLM 客户端:收口供应商细节与流式传输,业务侧只见这一个接口。
// 不变量:超时与重试在此一处配置;调用方拿到的是供应商无关的请求与响应,不见任何供应商 SDK 类型。
//
// 依赖经构造注入:config 给定端点与默认参数,deps 给定可替换的 fetch 与文本清理与退避等待。
// request 形如 { messages, tools?, temperature?, maxTokens? };complete 返回 { text, toolCalls, raw },
// stream 异步逐块产出 { text, toolCalls, done }。HTTP 与 SSE 协议细节只在本文件出现。

class LlmClient {
  constructor(config, deps) {
    this.apiKey = config.apiKey;
    this.baseURL = config.baseURL;
    this.model = config.model;
    this.temperature = config.temperature ?? 0.86;
    this.maxTokens = config.maxTokens ?? 2048;
    this.timeoutMs = config.timeoutMs ?? 120000;
    this.maxRetries = config.maxRetries ?? 0;
    this.retryDelayMs = config.retryDelayMs ?? 1000;

    this.fetch = deps.fetch;
    this.cleanResponse = deps.cleanResponse;
    // 退避等待可注入,便于测试时跳过真实计时
    this.sleep = deps.sleep ?? ((ms) => new Promise((resolve) => setTimeout(resolve, ms)));
  }

  //// 发起一次非流式补全,失败按重试次数退避重试,返回供应商无关响应 [@busybee 2026-06-13] ////
  async complete(request) {
    return this._withRetry(async () => {
      const response = await this._send(request, false);
      const data = await this._parseJson(response);
      return this._toResult(data);
    });
  }

  //// 发起一次流式请求,解析 SSE 增量并逐块产出 [@busybee 2026-06-13] ////
  async *stream(request) {
    const response = await this._send(request, true);
    yield* this._readSseDeltas(response);
  }

  //// 在超时与重试控制下执行一次请求,组装供应商协议的请求体 [@busybee 2026-06-13] ////
  async _send(request, isStream) {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), this.timeoutMs);

    const body = {
      model: this.model,
      messages: request.messages,
      max_tokens: request.maxTokens ?? this.maxTokens,
      temperature: request.temperature ?? this.temperature
    };
    if (request.tools) body.tools = request.tools;
    if (isStream) body.stream = true;

    try {
      const response = await this.fetch(`${this.baseURL}/chat/completions`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${this.apiKey}`
        },
        body: JSON.stringify(body),
        signal: controller.signal
      });
      clearTimeout(timeoutId);
      if (!response.ok) {
        const errorText = await response.text();
        throw new Error(`LLM 请求失败 ${response.status}: ${errorText}`);
      }
      return response;
    } catch (error) {
      clearTimeout(timeoutId);
      // 把供应商无关心的 AbortError 译为明确的超时错误
      if (error.name === 'AbortError') {
        throw new Error(`LLM 请求超时(${this.timeoutMs}ms)`);
      }
      throw error;
    }
  }

  //// 反复执行操作直到成功或耗尽重试次数,每次失败后退避等待 [@busybee 2026-06-13] ////
  async _withRetry(operation) {
    let lastError;
    for (let attempt = 0; attempt <= this.maxRetries; attempt++) {
      try {
        return await operation();
      } catch (error) {
        lastError = error;
        if (attempt < this.maxRetries) {
          await this.sleep(this.retryDelayMs);
        }
      }
    }
    throw lastError;
  }

  //// 解析非流式 JSON 响应体 [@busybee 2026-06-13] ////
  async _parseJson(response) {
    const data = await response.json();
    if (!data.choices || !data.choices[0]) {
      throw new Error('LLM 响应为空');
    }
    return data;
  }

  //// 把供应商响应折叠为无关响应:清理后的文本、工具调用、原始数据 [@busybee 2026-06-13] ////
  _toResult(data) {
    const message = data.choices[0].message || {};
    const text = message.content ? this.cleanResponse(message.content.trim()) : '';
    const toolCalls = message.tool_calls || [];
    return { text, toolCalls, raw: data };
  }

  //// 逐行读取 SSE 流,把每个 data 块解析为增量并产出,遇 [DONE] 收尾 [@busybee 2026-06-13] ////
  async *_readSseDeltas(response) {
    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let buffer = '';
    try {
      while (true) {
        const { value, done } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });

        // SSE 以空行分隔事件,逐行抽出已完整的 data 行
        let newlineIndex;
        while ((newlineIndex = buffer.indexOf('\n')) !== -1) {
          const line = buffer.slice(0, newlineIndex).trim();
          buffer = buffer.slice(newlineIndex + 1);
          if (!line.startsWith('data:')) continue;
          const payload = line.slice('data:'.length).trim();
          if (payload === '[DONE]') {
            yield { text: '', toolCalls: [], done: true };
            return;
          }
          yield this._toDelta(payload);
        }
      }
    } finally {
      reader.releaseLock();
    }
  }
  //// /逐行读取 SSE 流 ////

  //// 把单个 SSE data 负载解析为文本与工具调用增量 [@busybee 2026-06-13] ////
  _toDelta(payload) {
    const parsed = JSON.parse(payload);
    const delta = (parsed.choices && parsed.choices[0] && parsed.choices[0].delta) || {};
    return {
      text: delta.content || '',
      toolCalls: delta.tool_calls || [],
      done: false
    };
  }
}

module.exports = { LlmClient };
