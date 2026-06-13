// audience: internal
// # settings-gateway
// 设置面板对外能力的窄接口:把 preload 暴露的扁平 electronAPI 收窄成按领域分组的句柄。
// 不变量:子面板只见本文件交回的分组句柄,不直接抓 window.electronAPI 全量表。

//// 把 preload 暴露的 api 收窄成设置面板各领域所需的最小动作集 [@busybee 2026-06-13] ////
function makeSettingsGateway(electronApi) {
  const api = electronApi || {};
  return {
    config: {
      load: () => api.loadConfig(),
      save: (patch) => api.saveConfig(patch)
    },
    model: {
      selectFolder: () => api.selectModelFolder(),
      scanModel: (folder, file) => api.scanModelInfo(folder, file),
      selectImageFolder: () => api.selectImageFolder(),
      scanImageFolder: (folder) => api.scanImageFolder(folder),
      copyToUserData: (folder, name) => api.copyModelToUserdata(folder, name),
      selectBubbleImage: () => api.selectBubbleImage(),
      selectAppIcon: () => api.selectAppIcon()
    },
    character: {
      list: () => api.listCharacters(),
      loadPrompt: (id) => api.loadPrompt(id),
      savePrompt: (id, data) => api.savePrompt(id, data),
      create: (name) => api.createCharacter(name),
      rename: (id, name) => api.renameCharacter(id, name),
      remove: (id) => api.deleteCharacter(id),
      setActive: (id) => api.setActiveCharacter(id),
      import: () => api.importCharacter(),
      resetBuiltin: () => api.resetBuiltinCards()
    },
    tts: {
      status: () => api.ttsGetStatus(),
      restart: () => api.ttsRestart(),
      setConfig: (config) => api.ttsSetConfig(config),
      metas: () => api.ttsGetMetas(),
      synthesize: (text) => api.ttsSynthesize(text),
      availableVvms: () => api.ttsGetAvailableVvms(),
      downloadVvm: (file) => api.downloadVvm(file),
      setupVoicevox: () => api.setupVoicevox(),
      onSetupProgress: (cb) => api.onVoicevoxSetupProgress && api.onVoicevoxSetupProgress(cb),
      generateDefaultAudio: (phrases, styleId) => api.generateDefaultAudio(phrases, styleId)
    },
    system: {
      relaunch: () => api.appRelaunch(),
      openExternal: (url) => api.openExternal(url)
    }
  };
}

module.exports = { makeSettingsGateway };
