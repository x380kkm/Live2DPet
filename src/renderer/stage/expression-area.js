// audience: internal
// # expression-area
// 表达区:mod 前端与对话气泡是同一表达区的两个占用者,同一时刻至多一个占主导。
// 不变量:两占用者共用一块空间,主导权切换是排他的。

//// 表达区两个占用者的名字,由本文件单一定义 [@busybee 2026-06-13] ////
export const Occupant = Object.freeze({
  ModFrontend: 'mod-frontend',
  Bubble: 'bubble',
});

export class ExpressionArea {
  //// 经构造注入两占用者的激活与停用钩子,本身不触 DOM [@busybee 2026-06-13] ////
  // hooks:每个占用者一组 { activate, deactivate },由各视图提供;构造后无占用者主导。
  constructor(hooks = {}) {
    this.hooks = hooks;
    this.dominant = null;
  }

  //// 让一个占用者占主导:停用原主导、激活新主导,返回被替下的占用者名 [@busybee 2026-06-13] ////
  takeOver(occupant) {
    if (this.dominant === occupant) return null;
    const displaced = this.dominant;
    if (displaced) this._deactivate(displaced);
    this.dominant = occupant;
    this._activate(occupant);
    return displaced;
  }
  //// /让一个占用者占主导 ////

  //// 释放当前主导,表达区回到无人占用 [@busybee 2026-06-13] ////
  release() {
    if (!this.dominant) return;
    this._deactivate(this.dominant);
    this.dominant = null;
  }

  //// 查某占用者此刻是否占主导 [@busybee 2026-06-13] ////
  isDominant(occupant) {
    return this.dominant === occupant;
  }

  //// 调一个占用者的激活钩子,缺钩子时静默跳过 [@busybee 2026-06-13] ////
  _activate(occupant) {
    const hook = this.hooks[occupant];
    if (hook && typeof hook.activate === 'function') hook.activate();
  }

  //// 调一个占用者的停用钩子,缺钩子时静默跳过 [@busybee 2026-06-13] ////
  _deactivate(occupant) {
    const hook = this.hooks[occupant];
    if (hook && typeof hook.deactivate === 'function') hook.deactivate();
  }
}
