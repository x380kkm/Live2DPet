// audience: internal
// # layoutInfo-source
// 桌面布局上下文源:把当前打开的窗口按尺寸过滤后折成「标题 [宽x高]」逗号串,给模型静态布局参考。
// 不变量:id 取意图引用名 layoutInfo;只读窗口列表不内联人格;窗口不足下限返回 null 由组装器跳过。
//
// 依赖经构造注入:windowsProvider() 返回窗口条目数组,每条形如 { title, owner:{name}, bounds:{width,height} };
// shouldSkipApp(name) 判窗口是否略过,缺省全收;shortenTitle(title) 把窗口标题压短,缺省恒等。
// 迁移自旧 desktop-pet-system.sendRequest 的桌面布局摘要块(:608-632)。

const { ContextSource, estimateTextTokens } = require('../context-source');

class LayoutInfoSource extends ContextSource {
  //// 构造注入窗口列表源、略过判定、标题压缩与可覆盖的标识、优先级、标签、名次上限、尺寸下限、行数下限 [@busybee 2026-06-13] ////
  constructor(deps = {}, config = {}) {
    super();
    this.windowsProvider = deps.windowsProvider;
    this.shouldSkipApp = deps.shouldSkipApp || (() => false);
    this.shortenTitle = deps.shortenTitle || ((title) => title);
    this._id = config.id || 'layoutInfo';
    this._priority = config.priority != null ? config.priority : 10;
    // label 作结构化前缀,缺省为空,成品措辞由解析期按语言注入。
    this.label = config.label || '';
    // 取按出现顺序的前 topN 个窗口。
    this.topN = config.topN != null ? config.topN : 5;
    // 宽高都需超此像素值,滤掉最小化的任务栏按钮尺寸窗口。
    this.minSize = config.minSize != null ? config.minSize : 200;
    // 入选窗口数超此下限才并入上下文,太少不成布局。
    this.minLines = config.minLines != null ? config.minLines : 3;
  }
  //// /构造注入窗口列表源、略过判定、标题压缩与可覆盖的标识、优先级、标签、名次上限、尺寸下限、行数下限 ////

  get id() {
    return this._id;
  }

  get priority() {
    return this._priority;
  }

  estimateTokens(scope) {
    return estimateTextTokens(this.render(scope));
  }

  //// 取窗口列表滤掉略过项与小窗,折成「标题 [宽x高]」逗号串;窗口不足下限返回 null [@busybee 2026-06-13] ////
  render() {
    const lines = this._windows()
      .filter((w) => this._isVisibleWindow(w))
      .slice(0, this.topN)
      .map((w) => {
        const size = `${w.bounds.width}x${w.bounds.height}`;
        return `${this.shortenTitle(w.title || w.owner.name)} [${size}]`;
      });
    if (lines.length < this.minLines) {
      return null;
    }
    const body = lines.join(', ');
    return this.label ? this.label + body : body;
  }
  //// /取窗口列表滤掉略过项与小窗 ////

  //// 判窗口可见:有归属名且非略过应用、有尺寸且宽高都超下限 [@busybee 2026-06-13] ////
  _isVisibleWindow(w) {
    const name = w && w.owner && w.owner.name;
    if (!name || this.shouldSkipApp(name)) {
      return false;
    }
    const bounds = w.bounds;
    return Boolean(bounds && bounds.width > this.minSize && bounds.height > this.minSize);
  }
  //// /判窗口可见 ////

  //// 取窗口列表,缺数据时取空数组 [@busybee 2026-06-13] ////
  _windows() {
    if (typeof this.windowsProvider !== 'function') {
      return [];
    }
    const windows = this.windowsProvider();
    return Array.isArray(windows) ? windows : [];
  }
  //// /取窗口列表 ////
}

module.exports = { LayoutInfoSource };
