// audience: internal
// # context-source
// 上下文源接口与组装器:命名上下文源声明优先级与 token 预算,组装器按优先级排序累加到预算截断。
// 不变量:每个源以引用接入意图、不内联内容;render 返回 null 的源在组装时被跳过。

//// 上下文源接口:命名、可优先级、可估算预算、按作用域渲染 [@busybee 2026-06-13] ////
class ContextSource {
  get id() {
    throw new Error('子类必须给出 id');
  }

  get priority() {
    throw new Error('子类必须给出 priority');
  }

  estimateTokens() {
    throw new Error('子类必须实现 estimateTokens');
  }

  render(scope) {
    throw new Error('子类必须实现 render');
  }
}
//// /上下文源接口 ////

//// 把一段渲染逻辑包成命名上下文源,替代 sendRequest 里手工拼接的内联块 [@busybee 2026-06-13] ////
// 用一个渲染函数声明一个上下文源:idleInfo、focusInfo、hitContext 等过去写死在 sendRequest
// 里的片段各成一个实例,优先级与 token 估算随声明给定,render 在缺数据时返回 null 由组装器跳过。
class NamedContextSource extends ContextSource {
  // spec 形如 { id, priority, render, estimateTokens? };render(scope) 返回字符串或 null。
  constructor(spec) {
    super();
    this._id = spec.id;
    this._priority = spec.priority;
    this._render = spec.render;
    this._estimateTokens = spec.estimateTokens || null;
  }

  get id() {
    return this._id;
  }

  get priority() {
    return this._priority;
  }

  //// 估算本源渲染后的 token 数,缺省按字符数粗估 [@busybee 2026-06-13] ////
  estimateTokens(scope) {
    if (this._estimateTokens) {
      return this._estimateTokens(scope);
    }
    const fragment = this.render(scope);
    return estimateTextTokens(fragment);
  }

  render(scope) {
    return this._render(scope);
  }
}
//// /把一段渲染逻辑包成命名上下文源 ////

//// 按字符数粗估文本 token 数:无文本计零 [@busybee 2026-06-13] ////
// 中英文混排无供应商无关的精确分词,这里按字符数除以经验系数 4 给一个上界够用的估算。
function estimateTextTokens(text) {
  if (!text) {
    return 0;
  }
  // 每 4 个字符约一个 token,向上取整避免低估。
  return Math.ceil(text.length / 4);
}

//// 上下文组装器:按优先级排序累加到预算截断,跳过渲染为空的源 [@busybee 2026-06-13] ////
class ContextAssembler {
  // 组装结果是按优先级排好序、累计 token 不超过 budget 的若干命名片段。
  // 返回 { fragments: [{ id, text, tokens }], text, tokens }。
  assemble(sources, scope, budget) {
    // 优先级数值大的先入选,相等时保持原始相对顺序保证可重现。
    const ordered = sources
      .map((source, index) => ({ source, index }))
      .sort((a, b) => b.source.priority - a.source.priority || a.index - b.index);

    const fragments = [];
    let usedTokens = 0;
    for (const { source } of ordered) {
      const text = source.render(scope);
      if (text === null || text === undefined || text === '') {
        continue;
      }
      const tokens = source.estimateTokens(scope);
      if (budget !== undefined && usedTokens + tokens > budget) {
        continue;
      }
      usedTokens += tokens;
      fragments.push({ id: source.id, text, tokens });
    }

    return {
      fragments,
      text: fragments.map((fragment) => fragment.text).join('\n'),
      tokens: usedTokens
    };
  }
}
//// /上下文组装器 ////

module.exports = { ContextSource, NamedContextSource, ContextAssembler, estimateTextTokens };
