// audience: internal
// # focusInfo-source
// 窗口焦点上下文源:把各窗口累计停留秒数按时长排前若干名,折成一行命名片段。
// 不变量:id 取意图引用名 focusInfo;只读焦点计数不内联人格;无焦点返回 null 由组装器跳过。
//
// 依赖经构造注入:focusProvider() 返回窗口键到累计秒数的映射;shortenTitle(title) 把窗口标题压短,
// 缺省恒等。迁移自旧 desktop-pet-system.buildDynamicContext 的窗口使用统计块(:220-228)。

const { ContextSource, estimateTextTokens } = require('../context-source');

class FocusInfoSource extends ContextSource {
  //// 构造注入焦点计数源、标题压缩函数与可覆盖的标识、优先级、标签、名次上限、秒单位 [@busybee 2026-06-13] ////
  constructor(deps = {}, config = {}) {
    super();
    this.focusProvider = deps.focusProvider;
    this.shortenTitle = deps.shortenTitle || ((title) => title);
    this._id = config.id || 'focusInfo';
    this._priority = config.priority != null ? config.priority : 30;
    this.label = config.label || '';
    // 取累计时长最高的前 topN 个窗口。
    this.topN = config.topN != null ? config.topN : 5;
    // 秒数后缀,作结构化单位标签。
    this.secondsUnit = config.secondsUnit != null ? config.secondsUnit : 's';
  }
  //// /构造注入焦点计数源、标题压缩函数与可覆盖的标识、优先级、标签、名次上限、秒单位 ////

  get id() {
    return this._id;
  }

  get priority() {
    return this._priority;
  }

  estimateTokens(scope) {
    return estimateTextTokens(this.render(scope));
  }

  //// 取焦点计数按秒数降序排前若干名,折成「标题: 秒数」逗号串;无计数返回 null [@busybee 2026-06-13] ////
  render() {
    const tracker = this._tracker();
    const entries = Object.entries(tracker).filter(([, seconds]) => seconds > 0);
    if (entries.length === 0) {
      return null;
    }
    const body = entries
      .sort((a, b) => b[1] - a[1])
      .slice(0, this.topN)
      .map(([name, seconds]) => `${this.shortenTitle(name)}: ${seconds}${this.secondsUnit}`)
      .join(', ');
    return this.label ? this.label + body : body;
  }
  //// /取焦点计数按秒数降序排前若干名 ////

  //// 取焦点计数映射,缺数据时取空对象 [@busybee 2026-06-13] ////
  _tracker() {
    if (typeof this.focusProvider !== 'function') {
      return {};
    }
    const tracker = this.focusProvider();
    return tracker && typeof tracker === 'object' ? tracker : {};
  }
}

module.exports = { FocusInfoSource };
