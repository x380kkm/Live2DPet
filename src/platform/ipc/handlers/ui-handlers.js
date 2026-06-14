// audience: internal
// # ui-handlers
// 展示与交互类进程间通道的处理器:气泡推送、上下文菜单、开发者工具、角色数据。
// 产出按通道名索引的处理器表,供 ipc-router 注册。
//
// 窗口经构造注入的取值函数取得,经窗口工厂句柄的 send 转发,裸 webContents 不出本层。
// 对话气泡是浮在桌宠上方的独立窗口,由构造注入的 bubble 控制器(deps.bubble:show/resize/hide)驱动;
// show-pet-chat、close-chat-bubble、resize-chat-bubble 三路通道都转交该控制器,本层不直接持有气泡窗口。
//
// 构造注入的协作者都只是窄接口,第三方类型(electron 的 Menu、webContents)留在 platform 工厂:
//   getPetWindow      返回宠物窗口句柄或 null,句柄由窗口工厂产出,带 send/setSize/openDevTools
//   getSettingsWindow 返回设置窗口句柄或 null
//   createSettingsWindow 设置窗口不存在时新建并显示
//   menuPopup         上下文菜单弹出器,popup(template, rawWindow):template 为平直菜单数组
//   isAlive           判断窗口句柄是否存活,转发前据此过滤死窗口
//   mt                取菜单标签的翻译串
//   initialCharacterData 角色数据初值,缺省为空对象
//
// 处理器形参 payload 沿用 ipc-router 约定:单参通道收到值本身,多参通道收到参数数组。

//// 宠物窗口可选的方形尺寸,上下文菜单据此列出尺寸子菜单 [@busybee 2026-06-13] ////
const PET_SIZES = [200, 300, 400, 500];

//// 推送到宠物窗口的通道名:角色更新、尺寸已变(气泡改由独立窗口承载,不再走宠物窗口) [@busybee 2026-06-14] ////
const RENDER_CHANNEL = {
  characterUpdate: 'character-update',
  sizeChanged: 'size-changed'
};
//// /推送到宠物窗口的通道名 ////

//// 装配展示与交互处理器:取注入的窄接口,返回按通道名索引的处理器表 [@busybee 2026-06-13] ////
function createUiHandlers(deps) {
  const { getPetWindow, getSettingsWindow, createSettingsWindow, menuPopup, isAlive, mt } = deps;
  const translate = mt || ((key) => key);
  // 气泡控制器:显示发言、改尺寸、隐藏都驱动独立气泡窗口;缺省给无害空实现。
  const bubble = deps.bubble || { show() {}, resize() {}, hide() {} };

  // 角色数据为本层持有的可变快照,更新通道合并补丁,读取通道返回快照。
  let characterData = { ...(deps.initialCharacterData || {}) };

  //// 取存活的宠物窗口句柄,已毁或未建返回 null [@busybee 2026-06-13] ////
  function alivePetWindow() {
    const window = getPetWindow();
    return isAlive(window) ? window : null;
  }

  //// 取存活的设置窗口句柄,已毁或未建返回 null [@busybee 2026-06-13] ////
  function aliveSettingsWindow() {
    const window = getSettingsWindow();
    return isAlive(window) ? window : null;
  }

  //// 把发言文本经气泡控制器显示到独立气泡窗口 [@busybee 2026-06-14] ////
  function showPetChat(message, autoCloseTime) {
    bubble.show(message, autoCloseTime || 8000);
    return { success: true };
  }

  //// 经气泡控制器隐藏气泡窗口 [@busybee 2026-06-14] ////
  function closeChatBubble() {
    bubble.hide();
    return { success: true };
  }

  //// 经气泡控制器把气泡窗口改到目标宽高并重定位到桌宠上方 [@busybee 2026-06-14] ////
  function resizeChatBubble(width, height) {
    bubble.resize(width, height);
    return { success: true };
  }

  //// 在宠物窗口上弹出上下文菜单:尺寸子菜单、设置、关闭 [@busybee 2026-06-13] ////
  // 菜单项点击的副作用都经窗口句柄下达;Menu 的构建、弹出与弹出目标都封在注入的 menuPopup 里。
  function showPetContextMenu() {
    const window = alivePetWindow();
    if (!window) return { success: false, error: 'no pet window' };
    menuPopup.popup(buildContextMenuTemplate(window), window);
    return { success: true };
  }

  //// 组出上下文菜单的平直模板:尺寸子菜单改窗并回报、设置项显示或新建、关闭项关窗 [@busybee 2026-06-13] ////
  function buildContextMenuTemplate(window) {
    const sizeItems = PET_SIZES.map((size) => ({
      label: `${size}x${size}`,
      click: () => {
        window.setSize(size, size);
        window.send(RENDER_CHANNEL.sizeChanged, size);
      }
    }));
    return [
      { label: translate('main.size'), submenu: sizeItems },
      { type: 'separator' },
      { label: translate('main.settings'), click: () => showOrCreateSettings() },
      { label: translate('main.close'), click: () => { const pet = alivePetWindow(); if (pet) pet.close(); } }
    ];
  }

  //// 设置窗口存活则显示并聚焦,否则新建 [@busybee 2026-06-13] ////
  function showOrCreateSettings() {
    const settings = aliveSettingsWindow();
    if (settings) { settings.show(); settings.focus(); return; }
    if (typeof createSettingsWindow === 'function') createSettingsWindow();
  }

  //// 在宠物窗口打开开发者工具,缺宠物窗口仍回成功 [@busybee 2026-06-13] ////
  function openDevTools() {
    const window = alivePetWindow();
    if (window) window.openDevTools();
    return { success: true };
  }

  //// 合并角色数据补丁并推给宠物窗口热更,缺宠物窗口只更新快照 [@busybee 2026-06-13] ////
  function updatePetCharacter(data) {
    if (data) characterData = { ...characterData, ...data };
    const window = alivePetWindow();
    if (window) window.send(RENDER_CHANNEL.characterUpdate, characterData);
    return { success: true };
  }

  //// 返回当前角色数据快照 [@busybee 2026-06-13] ////
  function getCharacterData() {
    return characterData;
  }

  return {
    'show-pet-chat': (payload) => showPetChat(payload[0], payload[1]),
    'close-chat-bubble': () => closeChatBubble(),
    'resize-chat-bubble': (payload) => resizeChatBubble(payload[0], payload[1]),
    'show-pet-context-menu': () => showPetContextMenu(),
    'open-dev-tools': () => openDevTools(),
    'update-pet-character': (payload) => updatePetCharacter(payload),
    'get-character-data': () => getCharacterData()
  };
}
//// /装配展示与交互处理器 ////

//// 把展示与交互处理器表逐项经 ipc-router 注册 [@busybee 2026-06-13] ////
function registerUiHandlers(deps) {
  const { router } = deps;
  const table = createUiHandlers(deps);
  for (const [channel, handler] of Object.entries(table)) {
    router.register(channel, handler);
  }
}
//// /把展示与交互处理器表逐项注册 ////

module.exports = { createUiHandlers, registerUiHandlers, RENDER_CHANNEL, PET_SIZES };
