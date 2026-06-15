// audience: internal
// # pet-position-source
// 宠物位置上下文源:把宠物窗口在屏幕上的坐标与尺寸代入标签模板折成一行,助模型在截图里认出自己。
// 不变量:id 取意图引用名 petPosition;只读窗口边界不内联人格;无边界返回 null 由组装器跳过。
//
// 依赖经构造注入:boundsProvider() 返回宠物窗口边界 { x, y, width, height }。
// labelTemplate 含占位符 {x}{y}{w}{h},渲染时分别替换为坐标与尺寸,缺省给紧凑回退串。

const { ContextSource, estimateTextTokens } = require('../context-source');

class PetPositionSource extends ContextSource {
  //// 构造注入边界取数函数与可覆盖的标识、优先级、标签模板 [@x380kkm 2026-06-13] ////
  constructor(deps = {}, config = {}) {
    super();
    this.boundsProvider = deps.boundsProvider;
    this._id = config.id || 'petPosition';
    this._priority = config.priority != null ? config.priority : 60;
    // 标签模板含占位符 {x}{y}{w}{h},缺省给紧凑回退串,成品措辞由解析期按语言注入。
    this.labelTemplate = config.labelTemplate || '({x},{y}) {w}x{h}';
  }
  //// /构造注入边界取数函数与可覆盖的标识、优先级、标签模板 ////

  get id() {
    return this._id;
  }

  get priority() {
    return this._priority;
  }

  estimateTokens(scope) {
    return estimateTextTokens(this.render(scope));
  }

  //// 取宠物窗口边界代入标签模板的坐标与尺寸占位符;无边界返回 null [@x380kkm 2026-06-13] ////
  render() {
    const bounds = this._bounds();
    if (!bounds) {
      return null;
    }
    return this.labelTemplate
      .replace('{x}', bounds.x)
      .replace('{y}', bounds.y)
      .replace('{w}', bounds.width)
      .replace('{h}', bounds.height);
  }
  //// /取宠物窗口边界代入标签模板 ////

  //// 取宠物窗口边界:四字段齐备且都为有限数才采纳,否则返回 null [@x380kkm 2026-06-13] ////
  _bounds() {
    if (typeof this.boundsProvider !== 'function') {
      return null;
    }
    const bounds = this.boundsProvider();
    if (!bounds || typeof bounds !== 'object') {
      return null;
    }
    const fields = [bounds.x, bounds.y, bounds.width, bounds.height];
    const allFinite = fields.every((v) => typeof v === 'number' && Number.isFinite(v));
    return allFinite ? bounds : null;
  }
  //// /取宠物窗口边界 ////
}

module.exports = { PetPositionSource };
