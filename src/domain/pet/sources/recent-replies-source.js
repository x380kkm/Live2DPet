// audience: internal
// # recentReplies-source
// 近期回复上下文源:从最近若干条回复里检出重复的句式模式,折成一行反重复提示片段。
// 不变量:id 取意图引用名 recentReplies;只读回复文本不内联人格;无可检模式返回 null 由组装器跳过。
//
// 依赖经构造注入:recentRepliesProvider() 返回最近的回复文本数组(新旧顺序不限);
// labels 给各模式与提示外壳的结构化措辞,缺省给中性占位。迁移自旧 desktop-pet-system 的
// buildDynamicContext 反重复块与 _detectRepetition(:230-292)。

const { ContextSource, estimateTextTokens } = require('../context-source');

//// 缺省模式标签:中性占位,成品措辞由调用方按语言注入 [@busybee 2026-06-13] ////
function defaultLabels() {
  return {
    shell: '近期回复重复:{0}',
    separator: '、',
    question: '反复发问',
    opening: '开头雷同',
    ending: '结尾雷同',
    length: '长度雷同',
    exclamation: '叹号过多',
    ellipsis: '省略号过多'
  };
}
//// /缺省模式标签 ////

class RecentRepliesSource extends ContextSource {
  //// 构造注入近期回复源与可覆盖的标识、优先级、检测窗、标签 [@busybee 2026-06-13] ////
  constructor(deps = {}, config = {}) {
    super();
    this.recentRepliesProvider = deps.recentRepliesProvider;
    this._id = config.id || 'recentReplies';
    this._priority = config.priority != null ? config.priority : 50;
    // 只取最近 lookback 条回复参与检测。
    this.lookback = config.lookback != null ? config.lookback : 4;
    this.labels = { ...defaultLabels(), ...(config.labels || {}) };
  }
  //// /构造注入近期回复源与可覆盖的标识、优先级、检测窗、标签 ////

  get id() {
    return this._id;
  }

  get priority() {
    return this._priority;
  }

  estimateTokens(scope) {
    return estimateTextTokens(this.render(scope));
  }

  //// 取最近回复检出重复句式,折成反重复提示;无回复或无模式返回 null [@busybee 2026-06-13] ////
  render() {
    const replies = this._recentReplies();
    if (replies.length < 2) {
      return null;
    }
    const patterns = this._detectPatterns(replies.slice(-this.lookback));
    if (patterns.length === 0) {
      return null;
    }
    return this.labels.shell.replace('{0}', patterns.join(this.labels.separator));
  }
  //// /取最近回复检出重复句式 ////

  //// 检出反复发问、开头结尾雷同、长度雷同、叹号省略号过多等重复模式 [@busybee 2026-06-13] ////
  _detectPatterns(replies) {
    const patterns = [];

    const questionCount = replies.filter((r) => r.includes('？') || r.includes('?')).length;
    if (questionCount >= 2) {
      patterns.push(this.labels.question);
    }

    const openings = replies.map((r) => r.slice(0, 2));
    if (openings.length >= 2 && new Set(openings).size === 1) {
      patterns.push(this.labels.opening);
    }

    const endings = replies.map((r) => r.replace(/[。！？…\s]+$/, '').slice(-4));
    if (endings.length >= 2 && new Set(endings).size === 1) {
      patterns.push(this.labels.ending);
    }

    if (replies.length >= 3) {
      const lengths = replies.map((r) => r.length);
      const mean = lengths.reduce((a, b) => a + b, 0) / lengths.length;
      // 各条长度都在均值 ±20% 内视为长度雷同。
      const allSimilar = mean > 0 && lengths.every((l) => Math.abs(l - mean) / mean <= 0.2);
      if (allSimilar) {
        patterns.push(this.labels.length);
      }
    }

    const exclamationCount = replies.filter((r) => r.includes('！') || r.includes('!')).length;
    if (exclamationCount >= 3) {
      patterns.push(this.labels.exclamation);
    }

    const ellipsisCount = replies.filter((r) => r.includes('…') || r.includes('...')).length;
    if (ellipsisCount >= 3) {
      patterns.push(this.labels.ellipsis);
    }

    return patterns;
  }
  //// /检出反复发问、开头结尾雷同、长度雷同、叹号省略号过多等重复模式 ////

  //// 取最近回复文本数组,滤掉非字符串项 [@busybee 2026-06-13] ////
  _recentReplies() {
    if (typeof this.recentRepliesProvider !== 'function') {
      return [];
    }
    const replies = this.recentRepliesProvider();
    if (!Array.isArray(replies)) {
      return [];
    }
    return replies.filter((r) => typeof r === 'string' && r.length > 0);
  }
}

module.exports = { RecentRepliesSource };
