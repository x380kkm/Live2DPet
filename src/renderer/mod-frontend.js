// audience: internal
// # mod-frontend
// mod 前端宿主窗口的渲染脚本:订阅主进程的挂载消息,在窗口里承载一个 mod 前端。
// 不变量:只经 petBridge 暴露的窄接口收发,不直接碰 ipcRenderer;窗口尺寸与位置由主进程的 mod 前端控制器定。
// 本步(里程碑八·2)只占位渲染证明窗口与消息通路成立;纯数据模板渲染与可执行前端的 iframe 沙箱在里程碑八·4 接。

(function () {
  const bridge = window.petBridge || {};
  const events = bridge.events || {};
  const root = document.getElementById('mod-root');

  //// 收到挂载消息时把 mod 占位信息渲到承载区 [@busybee 2026-06-14] ////
  // payload 形如 { modId, title, mode };mode 为 'pure-data' 或 'sandboxed',里程碑八·4 据此分派渲染或沙箱。
  function mount(payload) {
    if (!root) return;
    const data = payload || {};
    root.textContent = data.title || data.modId || 'mod';
  }
  //// /收到挂载消息时把 mod 占位信息渲到承载区 ////

  if (events.onModFrontendMount) {
    events.onModFrontendMount((payload) => mount(payload));
  }
})();
