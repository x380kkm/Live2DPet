// audience: internal
// # preload
// 渲染侧入口:把 capability-gateway 与 channel-registry 声明的通道转成 window 上的窄接口。
// 不变量:按能力域分组暴露而非扁平等权全集;通道名只来自 channel-registry,本文件不写库外裸字符串。

const { contextBridge, ipcRenderer } = require('electron');
const channelRegistry = require('./src/platform/ipc/channel-registry');
const i18nTable = require('./src/i18n/locales');

const D = channelRegistry.CapabilityDomain;

//// 把契约目录里某能力域的通道收成「方法名到 invoke 调用」的窄句柄 [@busybee 2026-06-13] ////
// 通道名经 channel-registry 校验过域归属,方法名由 toMethodName 从通道名派生,渲染侧只见这层。
function groupOf(domain) {
  const group = {};
  for (const channel of channelRegistry.channels()) {
    if (channelRegistry.capabilityDomainOf(channel) !== domain) continue;
    group[toMethodName(channel)] = (...args) => ipcRenderer.invoke(channel, ...args);
  }
  return group;
}
//// /把契约目录里某能力域的通道收成窄句柄 ////

//// 把 kebab 通道名转成 camelCase 方法名,渲染侧按域取方法 [@busybee 2026-06-13] ////
function toMethodName(channel) {
  return channel.replace(/-([a-z])/g, (_, c) => c.toUpperCase());
}
//// /把 kebab 通道名转成 camelCase 方法名 ////

//// 主进程向渲染侧推送的事件:按事件名订阅,只暴露声明过的几路 [@busybee 2026-06-13] ////
// 这些是单向推送通道(主到渲染),不在 invoke 契约里,故单列;回调只拿到 payload。
const EVENTS = {
  onCharacterUpdate: 'character-update',
  onPetWindowClosed: 'pet-window-closed',
  onChatBubbleMessage: 'chat-bubble-message',
  onShowChatMessage: 'show-chat-message',
  onSizeChanged: 'size-changed',
  onPlayExpression: 'play-expression',
  onRevertExpression: 'revert-expression',
  onPlayMotion: 'play-motion',
  onTalkingStateChanged: 'talking-state-changed',
  onPetHoverState: 'pet-hover-state',
  onPetHit: 'pet-hit',
  onModelConfigUpdate: 'model-config-update',
  onVoicevoxSetupProgress: 'voicevox-setup-progress'
};

//// 把单向推送通道收成「订阅函数名到注册器」的窄句柄 [@busybee 2026-06-13] ////
function makeEventSubscribers() {
  const subscribers = {};
  for (const [name, channel] of Object.entries(EVENTS)) {
    subscribers[name] = (callback) => ipcRenderer.on(channel, (_event, ...args) => callback(...args));
  }
  return subscribers;
}
//// /把单向推送通道收成订阅句柄 ////

//// 按能力域分级暴露:无害控制与读写直放,屏幕、外发、文件三域为重能力单列 [@busybee 2026-06-13] ////
// 重能力域与无害控制域分桶暴露,而非过去那张约 70 通道扁平等权表;渲染侧按域取能力。
contextBridge.exposeInMainWorld('petBridge', {
  ui: groupOf(D.ui),
  config: groupOf(D.config),
  character: groupOf(D.character),
  emotion: groupOf(D.emotion),
  tts: groupOf(D.tts),
  system: groupOf(D.system),
  // 重能力:截屏、外发、文件分域单列,提示调用方它们经主进程能力网关门控
  screen: groupOf(D.screen),
  outbound: groupOf(D.outbound),
  file: groupOf(D.file),
  events: makeEventSubscribers(),
  // 渲染日志转发:单向发送,不进 invoke 契约
  rendererLog: (level, args) => ipcRenderer.send('renderer-log', level, args)
});
//// /按能力域分级暴露 ////

//// 单列界面文案表:它是静态参考数据而非能力通道,故不挂进 petBridge,另以 petI18n 暴露 [@busybee 2026-06-14] ////
// 设置界面据当前语言查表把动态文案译出;查不到的语言或键由界面侧回退 en 再回退键名。
contextBridge.exposeInMainWorld('petI18n', i18nTable);
//// /单列界面文案表 ////
