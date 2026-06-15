// audience: internal
// # mod-introduction-source
// 引入上下文源:把作用域里刚挂载 mod 的中性描述折成一段上下文,供引入台词那次管线调用陈述要介绍什么。
// 不变量:id 取意图引用名 modIntroduction;只读作用域里的中性描述,不内联人格;无描述返回 null 由组装器跳过。

const { ContextSource, estimateTextTokens } = require('../context-source');

class ModIntroductionSource extends ContextSource {
  //// 构造可覆盖标识与优先级,缺省高优先级 [@x380kkm 2026-06-14] ////
  // 引入台词那次调用以介绍新 mod 为主,故给较高优先级让它稳定进提示词。
  constructor(config = {}) {
    super();
    this._id = config.id || 'modIntroduction';
    this._priority = config.priority != null ? config.priority : 95;
  }

  get id() {
    return this._id;
  }

  get priority() {
    return this._priority;
  }

  estimateTokens(scope) {
    return estimateTextTokens(this.render(scope));
  }

  //// 取作用域里刚挂载 mod 的中性描述,无则返回 null [@x380kkm 2026-06-14] ////
  render(scope) {
    return (scope && scope.modIntroduction) || null;
  }
}

module.exports = { ModIntroductionSource };
