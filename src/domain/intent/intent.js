// audience: internal
// # intent
// 意图数据结构:模型侧在运行期从可枚举意图集里选一个的纯数据声明,含触发条件、上下文源清单、few-shot 引用、产物声明。
// 不变量:纯数据无方法无副作用;不含成品措辞、不含人格文本。

class Intent {
  constructor() {
    // 意图标识
    this.id = null;
    // 何时纳入候选,如有视觉输入、空闲、某个 mod 事件名
    this.trigger = null;
    // 按引用列出所需上下文源,不内联内容
    this.contextSourceRefs = [];
    // 只引结构样例,语气样例按角色解析
    this.fewShotRefs = [];
    // 产物声明:使用某个模板,或未来当场生成临时 mod
    this.product = null;
  }
}

module.exports = { Intent };
