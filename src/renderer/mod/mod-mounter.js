// audience: internal
// # mod-mounter
// mod 前端的承载:纯数据档把声明式模板渲成 DOM、零代码执行;可执行档把前端载入 iframe 沙箱、经白名单收窄。
// 不变量:沙箱 iframe 只给 allow-scripts、不给 allow-same-origin,内部文档 origin 为 null,拿不到父窗口的 window、document 与 petBridge;
//          来自沙箱的交互事件只放行 frontendSpec 声明的 emits 白名单内的事件名,白名单外的消息一律丢弃。

//// 判断一份前端规格是否为可执行沙箱档:kind 为 sandboxed [@busybee 2026-06-14] ////
export function isSandboxed(spec) {
  return !!spec && spec.kind === 'sandboxed';
}

//// 造受限 iframe 沙箱:只给 allow-scripts、srcdoc 载入前端,内部拿不到父窗口能力 [@busybee 2026-06-14] ////
// 不给 allow-same-origin,故沙箱文档 origin 为 null,无法访问父窗口 window、document 与 petBridge;只能经 postMessage 回传。
export function buildSandboxFrame(spec, doc) {
  const iframe = doc.createElement('iframe');
  iframe.setAttribute('sandbox', 'allow-scripts');
  iframe.setAttribute('referrerpolicy', 'no-referrer');
  iframe.style.cssText = 'width:100%;height:100%;border:none;background:transparent;';
  iframe.srcdoc = (spec && typeof spec.srcdoc === 'string') ? spec.srcdoc : '';
  return iframe;
}

//// 把纯数据声明模板渲成 DOM:标题、文本、按钮;按钮点击经 emit 产出交互事件 [@busybee 2026-06-14] ////
// spec 形如 { kind:'panel', title, items:[{type:'text',text}|{type:'button',label,event,payload}] }。
// 纯数据档零代码执行:渲染由本受信渲染器解释规格逐项建元素,不 eval、不写入 HTML 字符串。
export function renderPureData(spec, doc, emit) {
  const root = doc.createElement('div');
  root.className = 'mod-panel';
  if (spec && spec.title) {
    const title = doc.createElement('div');
    title.className = 'mod-title';
    title.textContent = spec.title;
    root.appendChild(title);
  }
  const items = (spec && Array.isArray(spec.items)) ? spec.items : [];
  for (const item of items) {
    if (!item || typeof item !== 'object') continue;
    if (item.type === 'text') {
      const line = doc.createElement('div');
      line.className = 'mod-text';
      line.textContent = item.text || '';
      root.appendChild(line);
    } else if (item.type === 'button') {
      const btn = doc.createElement('button');
      btn.className = 'mod-btn';
      btn.textContent = item.label || '';
      const name = item.event;
      const payload = item.payload || {};
      btn.addEventListener('click', () => { if (name) emit(name, payload); });
      root.appendChild(btn);
    }
  }
  return root;
}

//// 校验一条来自沙箱的消息是否为白名单内的交互事件,合法则返回规整后的事件 [@busybee 2026-06-14] ////
// 合法要求:{ type:'mod-event', name:string } 且 name 在 emits 白名单内;emits 为空视为不放行任何事件。
export function allowedInteraction(data, emits) {
  if (!data || data.type !== 'mod-event' || typeof data.name !== 'string' || !data.name) return null;
  const whitelist = Array.isArray(emits) ? emits : [];
  if (!whitelist.includes(data.name)) return null;
  const payload = (data.payload && typeof data.payload === 'object') ? data.payload : {};
  return { name: data.name, payload };
}

//// 把一个 mod 挂到承载根:纯数据直渲、可执行走沙箱并桥接消息;返回卸载函数 [@busybee 2026-06-14] ////
// payload 形如 { modId, frontendSpec, emits };deps:{ emit(name,payload), view(window) }。
// 沙箱档监听 message,只接受来自该 iframe 的、白名单内的交互事件转 emit,其余消息丢弃;卸载函数摘除监听。
export function mountMod(root, payload, deps) {
  const doc = root.ownerDocument;
  const data = payload || {};
  const spec = data.frontendSpec || {};
  const emits = data.emits || [];
  const emit = (deps && typeof deps.emit === 'function') ? deps.emit : () => {};
  const view = (deps && deps.view) || (doc && doc.defaultView) || null;

  while (root.firstChild) root.removeChild(root.firstChild);

  if (isSandboxed(spec)) {
    const iframe = buildSandboxFrame(spec, doc);
    root.appendChild(iframe);
    const onMessage = (event) => {
      // 只接受来自该 iframe 的消息,杜绝别处窗口冒充
      if (iframe.contentWindow && event.source !== iframe.contentWindow) return;
      const interaction = allowedInteraction(event.data, emits);
      if (interaction) emit(interaction.name, interaction.payload);
    };
    if (view && view.addEventListener) view.addEventListener('message', onMessage);
    return () => { if (view && view.removeEventListener) view.removeEventListener('message', onMessage); };
  }

  root.appendChild(renderPureData(spec, doc, emit));
  return () => {};
}
