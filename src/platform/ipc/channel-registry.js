// audience: internal
// # channel-registry
// 进程间通信通道契约的单一来源:通道名可枚举、可校验、按能力域分级。
// 不变量:两侧不再各写裸字符串,所有通道名只在本文件声明。

//// 声明能力域枚举:重能力(screen、outbound、file)受网关门控,其余为无害控制 [@x380kkm 2026-06-13] ////
const CapabilityDomain = {
  ui: 'ui',
  screen: 'screen',
  outbound: 'outbound',
  file: 'file',
  config: 'config',
  character: 'character',
  emotion: 'emotion',
  tts: 'tts',
  system: 'system'
};
//// /声明能力域枚举 ////

//// 把每个通道名映射到所属能力域,作为通道契约的单一目录 [@x380kkm 2026-06-13] ////
const CHANNEL_DOMAINS = {
  // 宠物窗口与窗口控制:无害 UI 控制
  'create-pet-window': CapabilityDomain.ui,
  'close-pet-window': CapabilityDomain.ui,
  'update-pet-character': CapabilityDomain.ui,
  'get-character-data': CapabilityDomain.ui,
  'set-window-size': CapabilityDomain.ui,
  'set-window-position': CapabilityDomain.ui,
  'get-window-bounds': CapabilityDomain.ui,
  'get-window-position': CapabilityDomain.ui,
  'show-pet-chat': CapabilityDomain.ui,
  'close-chat-bubble': CapabilityDomain.ui,
  'resize-chat-bubble': CapabilityDomain.ui,
  'get-cursor-position': CapabilityDomain.ui,
  'show-pet-context-menu': CapabilityDomain.ui,
  'report-mod-interaction': CapabilityDomain.ui,

  // 屏幕感知:截屏与列窗口为隐私重能力
  'get-screen-capture': CapabilityDomain.screen,
  'get-screen-capture-hq': CapabilityDomain.screen,
  'get-active-window': CapabilityDomain.screen,
  'get-open-windows': CapabilityDomain.screen,
  'get-system-idle-time': CapabilityDomain.screen,

  // 外发:打开外部链接与网络搜索为外发重能力
  'open-external': CapabilityDomain.outbound,
  'web-search': CapabilityDomain.outbound,

  // 文件:目录与文件选择、复制、写盘为文件系统重能力
  'select-model-folder': CapabilityDomain.file,
  'scan-model-info': CapabilityDomain.file,
  'select-static-image': CapabilityDomain.file,
  'select-image-folder': CapabilityDomain.file,
  'scan-image-folder': CapabilityDomain.file,
  'select-bubble-image': CapabilityDomain.file,
  'select-app-icon': CapabilityDomain.file,
  'copy-model-to-userdata': CapabilityDomain.file,
  'validate-model-paths': CapabilityDomain.file,
  'delete-profile': CapabilityDomain.file,
  'save-enhance-data': CapabilityDomain.file,
  'load-enhance-data': CapabilityDomain.file,
  'generate-default-audio': CapabilityDomain.file,
  'load-default-audio': CapabilityDomain.file,
  'download-vvm': CapabilityDomain.file,
  'setup-voicevox': CapabilityDomain.file,

  // 配置读写
  'load-config': CapabilityDomain.config,
  'save-config': CapabilityDomain.config,

  // 角色卡管理
  'list-characters': CapabilityDomain.character,
  'load-prompt': CapabilityDomain.character,
  'save-prompt': CapabilityDomain.character,
  'reset-prompt': CapabilityDomain.character,
  'create-character': CapabilityDomain.character,
  'delete-character': CapabilityDomain.character,
  'rename-character': CapabilityDomain.character,
  'set-active-character': CapabilityDomain.character,
  'import-character': CapabilityDomain.character,
  'reset-builtin-cards': CapabilityDomain.character,

  // 情绪与表现转发
  'trigger-expression': CapabilityDomain.emotion,
  'revert-expression': CapabilityDomain.emotion,
  'trigger-motion': CapabilityDomain.emotion,
  'report-hover-state': CapabilityDomain.emotion,
  'report-hit': CapabilityDomain.emotion,
  'set-talking-state': CapabilityDomain.emotion,

  // 文本转语音
  'tts-synthesize': CapabilityDomain.tts,
  'tts-get-status': CapabilityDomain.tts,
  'tts-restart': CapabilityDomain.tts,
  'tts-set-config': CapabilityDomain.tts,
  'tts-get-metas': CapabilityDomain.tts,
  'tts-get-available-vvms': CapabilityDomain.tts,

  // 系统级:应用路径、重启、开发者工具、设置面板、渲染日志转发
  'get-gender-term': CapabilityDomain.system,
  'open-dev-tools': CapabilityDomain.system,
  'get-app-path': CapabilityDomain.system,
  'show-settings': CapabilityDomain.system,
  'app-relaunch': CapabilityDomain.system,
  'renderer-log': CapabilityDomain.system
};
//// /把每个通道名映射到所属能力域 ////

//// 返回全部已声明的通道名,供两侧枚举校验 [@x380kkm 2026-06-13] ////
function channels() {
  return Object.keys(CHANNEL_DOMAINS);
}

//// 判断一个通道名是否在契约目录中 [@x380kkm 2026-06-13] ////
function isKnown(channelName) {
  return Object.prototype.hasOwnProperty.call(CHANNEL_DOMAINS, channelName);
}

//// 查一个通道名所属的能力域,未知通道返回 null [@x380kkm 2026-06-13] ////
function capabilityDomainOf(channelName) {
  if (!isKnown(channelName)) return null;
  return CHANNEL_DOMAINS[channelName];
}

module.exports = { channels, isKnown, capabilityDomainOf, CapabilityDomain };
