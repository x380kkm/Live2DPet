// audience: internal
// # visual-memory-source
// 视觉记忆上下文源:把近窗内已落盘的关键帧态势折成几行命名片段,给模型中期视觉记忆。
// 不变量:id 取意图引用名 visualMemory;只读记忆态势文本不内联人格;无记忆返回 null 由组装器跳过。
//
// 依赖经构造注入:memoryStore 暴露 recall({from,to,limit}) 返回最新在前的记忆条目,每条含 situation 文本;
// now 为注入时钟。

const { ContextSource, estimateTextTokens } = require('../context-source');

class VisualMemorySource extends ContextSource {
  //// 构造注入记忆库、时钟与可覆盖的标识、优先级、回看窗、上限 [@x380kkm 2026-06-13] ////
  constructor(deps = {}, config = {}) {
    super();
    this.memoryStore = deps.memoryStore;
    this.now = deps.now || (() => Date.now());
    this._id = config.id || 'visualMemory';
    this._priority = config.priority != null ? config.priority : 40;
    this.label = config.label || '';
    // 记忆回看窗与最多并入的近期记忆条数。
    this.recallWindowMs = config.recallWindowMs != null ? config.recallWindowMs : 600000;
    this.recallLimit = config.recallLimit != null ? config.recallLimit : 2;
  }
  //// /构造注入记忆库、时钟与可覆盖的标识、优先级、回看窗、上限 ////

  get id() {
    return this._id;
  }

  get priority() {
    return this._priority;
  }

  estimateTokens(scope) {
    return estimateTextTokens(this.render(scope));
  }

  //// 把近窗记忆的态势逐行折成带标签的片段;无记忆返回 null [@x380kkm 2026-06-13] ////
  render() {
    const lines = this._recentMemory()
      .map((entry) => entry && entry.situation)
      .filter((situation) => typeof situation === 'string' && situation.trim());
    if (lines.length === 0) {
      return null;
    }
    const body = lines.join('\n');
    return this.label ? this.label + '\n' + body : body;
  }
  //// /把近窗记忆的态势逐行折成带标签的片段 ////

  //// 经记忆库按回看窗读最近若干条记忆 [@x380kkm 2026-06-13] ////
  _recentMemory() {
    if (!this.memoryStore || typeof this.memoryStore.recall !== 'function') {
      return [];
    }
    const to = this.now();
    return this.memoryStore.recall({ from: to - this.recallWindowMs, to, limit: this.recallLimit });
  }
}

module.exports = { VisualMemorySource };
