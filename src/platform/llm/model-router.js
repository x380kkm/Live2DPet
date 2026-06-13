// audience: internal
// # model-router
// 步骤模型路由:按请求里的 step 解析该步配置,取或造对应模型客户端,转发调用。
// 不变量:与 LlmClient 同接口(complete/stream),可直接顶替注入点;客户端按配置身份缓存复用。
//
// 构造注入:stepModelConfig 给定两层解析,deps.makeClient(resolvedConfig) 造一个 LlmClient 同形客户端,
// deps.fallback 可选,给无 step 的请求兜底。请求形如 { messages, step, ... };step 缺失且无兜底则报错。
// resolveStep(stepId) 透出该步解析结果,供提示词层取 systemInjection 等。

//// 把解析出的配置压成稳定身份键,模型与参数全同才复用同一客户端 [@busybee 2026-06-13] ////
function identityKey(cfg) {
  return [
    cfg.preset, cfg.baseURL, cfg.apiKey, cfg.model,
    cfg.temperature, cfg.maxTokens, cfg.effort, cfg.thinking,
    JSON.stringify(cfg.extraBody || {})
  ].join('|');
}

class ModelRouter {
  //// 构造注入两层配置解析与客户端工厂 [@busybee 2026-06-13] ////
  constructor(stepModelConfig, deps = {}) {
    this._config = stepModelConfig;
    this._makeClient = deps.makeClient;
    this._fallback = deps.fallback || null;
    // 身份键到客户端的缓存:同配置只造一个客户端。
    this._cache = new Map();
  }

  //// 解析某步配置,透出供提示词层与诊断使用 [@busybee 2026-06-13] ////
  resolveStep(stepId) {
    return this._config.resolve(stepId);
  }

  //// 按步取或造对应客户端,身份相同则复用 [@busybee 2026-06-13] ////
  _clientForStep(stepId) {
    const cfg = this._config.resolve(stepId);
    const key = identityKey(cfg);
    let client = this._cache.get(key);
    if (!client) {
      client = this._makeClient(cfg);
      this._cache.set(key, client);
    }
    return client;
  }

  //// 取请求里的目标客户端:有 step 按步路由,无 step 用兜底,都没有则报错 [@busybee 2026-06-13] ////
  _routeOf(request) {
    const stepId = request && request.step;
    if (stepId) {
      return this._clientForStep(stepId);
    }
    if (this._fallback) {
      return this._fallback;
    }
    throw new Error('请求缺少 step,且未配置兜底客户端,无法路由模型');
  }

  //// 按步路由一次非流式补全 [@busybee 2026-06-13] ////
  async complete(request) {
    return this._routeOf(request).complete(request);
  }

  //// 按步路由一次流式请求 [@busybee 2026-06-13] ////
  async *stream(request) {
    yield* this._routeOf(request).stream(request);
  }
}

module.exports = { ModelRouter, identityKey };
