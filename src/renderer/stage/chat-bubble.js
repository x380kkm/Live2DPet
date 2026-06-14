// audience: internal
// # chat-bubble
// 对话气泡视图:受尺寸上限约束,默认小、按需展开。
// 不变量:气泡尺寸不超过表达区分配的预算上限。

//// 气泡尺寸预算:折叠态用小上限,展开态用大上限,均不超过表达区给的上限 [@busybee 2026-06-13] ////
// budget:{ collapsedMax:{width,height}, expandedMax:{width,height}, min:{width,height} }。
export const DEFAULT_BUDGET = Object.freeze({
  min: { width: 160, height: 60 },
  collapsedMax: { width: 300, height: 140 },
  expandedMax: { width: 420, height: 360 },
});

//// 把文本量算出的内容尺寸钳进当前态的预算区间 [@busybee 2026-06-13] ////
// measured 为文本撑出的内容宽高,expanded 决定用哪条上限;返回不越界的窗口尺寸。
export function budgetSize(measured, budget, expanded) {
  const max = expanded ? budget.expandedMax : budget.collapsedMax;
  const width = clamp(measured.width, budget.min.width, max.width);
  const height = clamp(measured.height, budget.min.height, max.height);
  return { width, height };
}

//// 把一个值钳进闭区间 [@busybee 2026-06-13] ////
function clamp(value, lo, hi) {
  if (value < lo) return lo;
  if (value > hi) return hi;
  return value;
}

export class ChatBubble {
  //// 经构造注入气泡元素、文本元素、窗口尺寸能力与预算,默认折叠 [@busybee 2026-06-13] ////
  // deps:{ frameElement, textElement, resizeWindow(width,height), budget? }。
  constructor(deps) {
    this.frameElement = deps.frameElement;
    this.textElement = deps.textElement;
    this.resizeWindow = deps.resizeWindow || (() => {});
    this.budget = deps.budget || DEFAULT_BUDGET;
    this.expanded = false;
    this.currentText = '';
  }

  //// 显示一段文本:写入文本、折叠为默认小、按预算调窗 [@busybee 2026-06-13] ////
  show(text) {
    this.currentText = text;
    this.expanded = false;
    if (this.textElement) this.textElement.textContent = text;
    if (this.frameElement && this.frameElement.style) this.frameElement.style.display = 'flex';
    this._applyBudget();
  }
  //// /显示一段文本 ////

  //// 展开到更大上限并重算窗口尺寸 [@busybee 2026-06-13] ////
  expand() {
    if (this.expanded) return;
    this.expanded = true;
    this._applyBudget();
  }

  //// 折叠回默认小上限并重算窗口尺寸 [@busybee 2026-06-13] ////
  collapse() {
    if (!this.expanded) return;
    this.expanded = false;
    this._applyBudget();
  }

  //// 隐藏气泡框 [@busybee 2026-06-13] ////
  hide() {
    if (this.frameElement && this.frameElement.style) this.frameElement.style.display = 'none';
  }

  //// 量出文本内容尺寸、按当前态钳进预算、请求宿主调窗 [@busybee 2026-06-13] ////
  _applyBudget() {
    const measured = this._measure();
    const sized = budgetSize(measured, this.budget, this.expanded);
    this.resizeWindow(sized.width, sized.height);
  }
  //// /量出文本内容尺寸 ////

  //// 量文本元素撑出的内容宽高,无元素时回退到预算下限 [@busybee 2026-06-13] ////
  _measure() {
    const el = this.textElement;
    if (!el || typeof el.getBoundingClientRect !== 'function') {
      return { width: this.budget.min.width, height: this.budget.min.height };
    }
    const rect = el.getBoundingClientRect();
    // 宽加 50、高加 60 留给气泡边框
    return { width: Math.ceil(rect.width) + 50, height: Math.ceil(rect.height) + 60 };
  }
}
