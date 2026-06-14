// audience: internal
// # llm-client
// 统一 LLM 客户端:收口供应商细节与流式传输,业务侧只见这一个接口。
// 不变量:超时与重试在此一处配置;调用方拿到的是供应商无关的请求与响应,不见任何供应商 SDK 类型。
//
// 依赖经构造注入:config 给定端点、模型与默认参数,deps 给定可替换的 fetch 与文本清理与退避等待。
// config.preset(或 config.profile)选供应商兼容预设,默认 openai-chat;协议差异止于 vendor-profiles。
// request 形如 { messages, tools?, temperature?, maxTokens?, model?, effort?, thinking? };complete 返回 { text, toolCalls, raw },
// stream 异步逐块产出 { text, toolCalls, done }。HTTP 与 SSE 协议细节只在本文件与所选预设里出现。

const { profileFor } = require('./vendor-profiles');

class LlmClient {
  constructor(config, deps) {
    this.apiKey = config.apiKey;
    this.baseURL = config.baseURL;
    this.model = config.model;
    this.temperature = config.temperature ?? 0.86;
    this.maxTokens = config.maxTokens ?? 2048;
    this.effort = config.effort;
    this.thinking = config.thinking;
    this.extraBody = config.extraBody;
    this.timeoutMs = config.timeoutMs ?? 120000;
    this.maxRetries = config.maxRetries ?? 0;
    this.retryDelayMs = config.retryDelayMs ?? 1000;
    // 供应商兼容预设:显式 profile 优先,否则按 preset 名解析,默认 openai-chat。
    this.profile = config.profile || profileFor(config.preset);

    this.fetch = deps.fetch;
    this.cleanResponse = deps.cleanResponse;
    // 退避等待可注入。
    this.sleep = deps.sleep ?? ((ms) => new Promise((resolve) => setTimeout(resolve, ms)));
  }

  //// 发起一次非流式补全,失败按重试次数退避重试,返回供应商无关响应 [@busybee 2026-06-13] ////
  async complete(request) {
    return this._withRetry(async () => {
      const response = await this._send(request, false);
      const data = await response.json();
      return this._toResult(data);
    });
  }

  //// 发起一次流式请求,解析 SSE 增量并逐块产出 [@busybee 2026-06-13] ////
  async *stream(request) {
    const response = await this._send(request, true);
    yield* this._readSseDeltas(response);
  }

  //// 把请求里的覆盖值叠到客户端默认上,得到本次调用的参数 [@busybee 2026-06-13] ////
  _params(request) {
    return {
      model: request.model !== undefined ? request.model : this.model,
      temperature: this.temperature,
      maxTokens: this.maxTokens,
      effort: this.effort,
      thinking: this.thinking,
      extraBody: this.extraBody
    };
  }

  //// 在超时与重试控制下执行一次请求,经所选预设组装请求体与鉴权头 [@busybee 2026-06-13] ////
  async _send(request, isStream) {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), this.timeoutMs);

    const body = this.profile.buildBody(request, this._params(request), isStream);
    const headers = { 'Content-Type': 'application/json', ...this.profile.authHeaders(this.apiKey) };

    try {
      const response = await this.fetch(`${this.baseURL}${this.profile.path}`, {
        method: 'POST',
        headers,
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

  //// 把供应商响应折叠为无关响应:经预设解析再清理文本,透出工具调用与原始数据 [@busybee 2026-06-13] ////
  _toResult(data) {
    const parsed = this.profile.parseComplete(data);
    const text = parsed.text ? this.cleanResponse(parsed.text.trim()) : '';
    return { text, toolCalls: parsed.toolCalls || [], raw: data };
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

  //// 把单个 SSE data 负载经所选预设解析为文本与工具调用增量 [@busybee 2026-06-13] ////
  _toDelta(payload) {
    const parsed = JSON.parse(payload);
    return this.profile.parseDelta(parsed);
  }
}

module.exports = { LlmClient };
