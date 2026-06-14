// audience: internal
// # tone-hint-source
// 语气提示上下文源:把下一句话预定的情绪代入标签模板折成一行,引导模型让语气自然反映该情绪。
// 不变量:id 取意图引用名 toneHint;只读情绪标签不内联人格;无预定情绪返回 null 由组装器跳过。
//
// 依赖经构造注入:toneProvider() 返回下一句话的情绪标签字符串;退而取 scope.nextEmotion。
// labelTemplate 含占位符 {0},渲染时替换为情绪标签,缺省直接给标签。

const { ContextSource, estimateTextTokens } = require('../context-source');

class ToneHintSource extends ContextSource {
  //// 构造注入情绪取数函数与可覆盖的标识、优先级、标签模板 [@busybee 2026-06-13] ////
  constructor(deps = {}, config = {}) {
    super();
    this.toneProvider = deps.toneProvider;
    this._id = config.id || 'toneHint';
    this._priority = config.priority != null ? config.priority : 70;
    // 标签模板含占位符 {0},缺省直接给情绪标签,成品措辞由解析期按语言注入。
    this.labelTemplate = config.labelTemplate || '{0}';
  }
  //// /构造注入情绪取数函数与可覆盖的标识、优先级、标签模板 ////

  get id() {
    return this._id;
  }

  get priority() {
    return this._priority;
  }

  estimateTokens(scope) {
    return estimateTextTokens(this.render(scope));
  }

  //// 取下一句话预定情绪代入标签模板;无预定情绪返回 null [@busybee 2026-06-13] ////
  render(scope) {
    const emotion = this._nextEmotion(scope);
    if (!emotion) {
      return null;
    }
    return this.labelTemplate.replace('{0}', emotion);
  }
  //// /取下一句话预定情绪代入标签模板 ////

  //// 取下一句话情绪标签:优先注入的取数函数,退而取作用域字段;不是非空字符串时返回 null [@busybee 2026-06-13] ////
  _nextEmotion(scope) {
    let value = null;
    if (typeof this.toneProvider === 'function') {
      value = this.toneProvider();
    } else if (scope && scope.nextEmotion != null) {
      value = scope.nextEmotion;
    }
    return typeof value === 'string' && value.trim() ? value : null;
  }
  //// /取下一句话情绪标签 ////
}

module.exports = { ToneHintSource };
