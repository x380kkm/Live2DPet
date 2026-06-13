// audience: internal
// # mod-frontend
// mod 前端宿主窗口的渲染脚本:订阅主进程的挂载消息,把 mod 前端承载进窗口,并把交互事件回流给主进程。
// 不变量:只经 petBridge 暴露的窄接口收发,不直接碰 ipcRenderer;承载与沙箱细节收在 mod-mounter 内。
// 交互事件回流到意图在里程碑八·5 接通主进程一侧;通道未接通时 emit 为无害空操作。

import { mountMod } from './mod/mod-mounter.js';

(function () {
  const bridge = window.petBridge || {};
  const events = bridge.events || {};
  const ui = bridge.ui || {};
  const root = document.getElementById('mod-root');
  let unmount = () => {};

  //// 把一次交互回流给主进程:经 petBridge 的 ui 域上报,通道未接通时静默跳过 [@busybee 2026-06-14] ////
  function emit(name, payload) {
    try { if (ui.reportModInteraction) ui.reportModInteraction(name, payload); } catch (e) { /* 通道未接通,忽略 */ }
  }
  //// /把一次交互回流给主进程 ////

  //// 收到挂载消息时承载 mod 前端:先卸载旧的,再按规格挂新的 [@busybee 2026-06-14] ////
  function mount(payload) {
    if (!root) return;
    unmount();
    unmount = mountMod(root, payload, { emit, view: window });
  }
  //// /收到挂载消息时承载 mod 前端 ////

  if (events.onModFrontendMount) {
    events.onModFrontendMount((payload) => mount(payload));
  }
})();
