// audience: internal
// # request-pipeline
// 可装配请求管线:收集启用的上下文源,按意图筛选与排序,组装提示词,调模型产出回应。
// 不变量:上下文源、过滤器、意图路由各为可重排可开关的阶段,管线自身不抓全局配置。

const { ContextAssembler } = require('./context-source');

class RequestPipeline {
  //// 构造注入可重排的阶段与平台接口 [@busybee 2026-06-13] ////
  // deps 形如:
  //   sources    上下文源注册表,registry.get(id) 取一个命名上下文源
  //   llmClient  平台 LLM 客户端,complete(request) 返回 { text, toolCalls, raw }
  //   assembler  上下文组装器,缺省用默认 ContextAssembler
  //   filters    回应后处理过滤器数组,各为 (text, scope) => text,可开关可重排
  //   promptComposer  把已组装上下文与意图拼成 LLM 请求的 messages,经注入避免内联拼接
  //   budget     上下文 token 预算上限
  constructor(deps) {
    this.sources = deps.sources;
    this.llmClient = deps.llmClient;
    this.assembler = deps.assembler || new ContextAssembler();
    this.filters = deps.filters || [];
    this.promptComposer = deps.promptComposer;
    this.budget = deps.budget;
  }

  //// 按意图跑一次管线:收集上下文源、组装、调模型、过滤,产出回应三元组 [@busybee 2026-06-13] ////
  // 返回 { text, emotion, modEvents, context },text 已过完所有后处理过滤器。
  async run(intent, scope) {
    const sources = this._collectSources(intent);
    const context = this.assembler.assemble(sources, scope, this.budget);
    const request = this.promptComposer.compose(intent, context, scope);

    const result = await this.llmClient.complete(request);
    const text = this._applyFilters(result.text, scope);

    return {
      text,
      emotion: scope && scope.emotion ? scope.emotion : null,
      modEvents: [],
      context
    };
  }
  //// /按意图跑一次管线 ////

  //// 按意图声明的上下文源引用从注册表取出启用的源 [@busybee 2026-06-13] ////
  // 意图只按引用列源,管线在此解析成实例并丢弃注册表里缺失或未启用的引用。
  _collectSources(intent) {
    const refs = (intent && intent.contextSourceRefs) || [];
    const collected = [];
    for (const ref of refs) {
      const source = this.sources.get(ref);
      if (source) {
        collected.push(source);
      }
    }
    return collected;
  }

  //// 依次施加各后处理过滤器,任一过滤器返回空则保留上一版文本 [@busybee 2026-06-13] ////
  _applyFilters(text, scope) {
    let filtered = text;
    for (const filter of this.filters) {
      const next = filter(filtered, scope);
      if (next !== null && next !== undefined && next !== '') {
        filtered = next;
      }
    }
    return filtered;
  }
}

module.exports = { RequestPipeline };
