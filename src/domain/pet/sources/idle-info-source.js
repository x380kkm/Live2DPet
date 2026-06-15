// audience: internal
// # idle-info-source
// 空闲上下文源:把距上次键鼠输入的空闲秒数折成一行命名片段,只在超过阈值时给出。
// 不变量:id 取意图引用名 idleInfo;只读空闲秒数不内联人格;不足阈值返回 null 由组装器跳过。
//
// 依赖经构造注入:idleProvider() 返回当前空闲秒数;缺该依赖时退而取 scope.idleSeconds。
// labelTemplate 含占位符 {0},渲染时替换为秒数。

const { ContextSource, estimateTextTokens } = require('../context-source');

class IdleInfoSource extends ContextSource {
  //// 构造注入空闲秒数源与可覆盖的标识、优先级、阈值、标签模板 [@x380kkm 2026-06-13] ////
  constructor(deps = {}, config = {}) {
    super();
    this.idleProvider = deps.idleProvider;
    this._id = config.id || 'idleInfo';
    this._priority = config.priority != null ? config.priority : 20;
    // 空闲秒数达此阈值才并入上下文。
    this.thresholdSec = config.thresholdSec != null ? config.thresholdSec : 60;
    // 标签模板含占位符 {0},缺省直接给秒数。
    this.labelTemplate = config.labelTemplate || '{0}';
  }
  //// /构造注入空闲秒数源与可覆盖的标识、优先级、阈值、标签模板 ////

  get id() {
    return this._id;
  }

  get priority() {
    return this._priority;
  }

  estimateTokens(scope) {
    return estimateTextTokens(this.render(scope));
  }

  //// 取空闲秒数,达阈值则代入标签模板;不足阈值返回 null [@x380kkm 2026-06-13] ////
  render(scope) {
    const idleSec = this._idleSeconds(scope);
    if (idleSec == null || idleSec < this.thresholdSec) {
      return null;
    }
    return this.labelTemplate.replace('{0}', idleSec);
  }
  //// /取空闲秒数,达阈值则代入标签模板 ////

  //// 取空闲秒数:优先注入的取数函数,退而取作用域字段;非数返回 null [@x380kkm 2026-06-13] ////
  _idleSeconds(scope) {
    let value = null;
    if (typeof this.idleProvider === 'function') {
      value = this.idleProvider();
    } else if (scope && scope.idleSeconds != null) {
      value = scope.idleSeconds;
    }
    return typeof value === 'number' && Number.isFinite(value) ? value : null;
  }
}

module.exports = { IdleInfoSource };
