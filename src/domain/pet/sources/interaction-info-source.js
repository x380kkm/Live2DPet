// audience: internal
// # interactionInfo-source
// 交互信息上下文源:把作用域里当下这次交互(点击、触摸、拖拽等)折成一行,让模型据此对身体交互作出回应。
// 不变量:id 取意图引用名 interactionInfo;只描述发生了什么交互,不写角色文风与成品措辞;无交互返回 null 由组装器跳过。
//
// 依赖经构造注入:config.labels 把交互事件名映射成一句客观描述(系统侧感知文本,非台词)。
// 交互语义由交互路由放进 scope.interaction = { name, payload };本源据 name 取描述。

const { ContextSource, estimateTextTokens } = require('../context-source');

// 出厂默认描述:客观陈述发生了哪种身体交互,供模型理解当下情境;具体怎么回应由人格与样例决定。
const DEFAULT_LABELS = Object.freeze({
  click: '用户刚刚点了你一下。',
  touch: '用户刚刚轻轻摸了摸你。',
  drag: '用户刚刚拖动了你。',
  swipe: '用户刚刚从你身上滑过。',
  resize: '用户刚刚改变了你的大小。'
});

class InteractionInfoSource extends ContextSource {
  //// 构造注入可覆盖的标识、优先级、交互描述表 [@busybee 2026-06-14] ////
  constructor(deps = {}, config = {}) {
    super();
    this._id = config.id || 'interactionInfo';
    // 优先级高:当下这次交互是最该被回应的情境,排在其余上下文之前。
    this._priority = config.priority != null ? config.priority : 95;
    this._labels = config.labels || DEFAULT_LABELS;
  }
  //// /构造注入可覆盖的标识、优先级、交互描述表 ////

  get id() {
    return this._id;
  }

  get priority() {
    return this._priority;
  }

  estimateTokens(scope) {
    return estimateTextTokens(this.render(scope));
  }

  //// 取当下交互名代入描述表;无交互返回 null [@busybee 2026-06-14] ////
  render(scope) {
    const interaction = scope && scope.interaction;
    if (!interaction || !interaction.name) {
      return null;
    }
    return this._labels[interaction.name] || `用户刚刚和你有了一次「${interaction.name}」交互。`;
  }
  //// /取当下交互名代入描述表 ////
}

module.exports = { InteractionInfoSource, DEFAULT_LABELS };
