// audience: internal
// # mod-frontend-slot
// mod 前端槽:经 sandbox-host 嵌入可执行前端,管插入与切换动画。
// 不变量:前端经沙箱宿主嵌入,槽本身不直接持有原始能力网关。

export class ModFrontendSlot {
  //// 经构造注入槽元素与沙箱宿主,槽初始为空 [@busybee 2026-06-13] ////
  // deps:{ slotElement, sandboxHost }。sandboxHost 实现 host/dispose,槽只见这层窄接口。
  constructor(deps) {
    this.slotElement = deps.slotElement;
    this.sandboxHost = deps.sandboxHost;
    this.frame = null;
    this.frontendSpec = null;
  }

  //// 嵌入一份前端规格:经沙箱宿主取受限框架,挂入槽并标记可见 [@busybee 2026-06-13] ////
  embed(frontendSpec) {
    if (this.frame) this.clear();
    this.frontendSpec = frontendSpec;
    this.frame = this.sandboxHost.host(frontendSpec);
    if (this.slotElement && this.frame && this.frame.element) {
      this.slotElement.appendChild(this.frame.element);
    }
    this._setVisible(true);
    return this.frame;
  }
  //// /嵌入一份前端规格 ////

  //// 切换到另一份前端规格:同规格免动、不同则清旧嵌新 [@busybee 2026-06-13] ////
  switchTo(frontendSpec) {
    if (this.frontendSpec && frontendSpec && this.frontendSpec.id === frontendSpec.id) {
      return this.frame;
    }
    return this.embed(frontendSpec);
  }

  //// 清空槽:销毁当前沙箱框架、摘除元素、标记不可见 [@busybee 2026-06-13] ////
  clear() {
    if (this.frame) {
      if (this.frame.element && this.frame.element.parentNode) {
        this.frame.element.parentNode.removeChild(this.frame.element);
      }
      if (typeof this.frame.dispose === 'function') this.frame.dispose();
      this.frame = null;
    }
    this.frontendSpec = null;
    this._setVisible(false);
  }
  //// /清空槽 ////

  //// 查槽此刻是否已嵌入前端 [@busybee 2026-06-13] ////
  hasFrontend() {
    return this.frame !== null;
  }

  //// 切槽元素的可见类,缺元素时静默跳过 [@busybee 2026-06-13] ////
  _setVisible(visible) {
    const el = this.slotElement;
    if (!el || !el.classList) return;
    if (visible) el.classList.add('slot-active');
    else el.classList.remove('slot-active');
  }
}
