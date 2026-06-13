// audience: internal
// # tts-handlers
// TTS 与 VOICEVOX 安装相关进程间通道的处理器:合成、状态、配置、模型列举与安装下载。
// 迁移自旧 src/main/tts-ipc.js;分句与拼接已沉到 tts-orchestrator,后端细节在 voicevox-backend,安装下载在 voicevox-installer。
// 不变量:本文件不写裸通道名(经 ipc-router 校验),不直接碰 FFI、文件系统路径字面量与官方资源地址。
// 构造注入:router(ipc-router)、speechBackend(文本进音频出)、orchestrator(分句拼接)、translate(可选译者)、configStore(配置持久化)、installer(安装下载)、resolveVoicevoxDir(算资源根)、relaunch(重启应用)、notifyProgress(上报安装进度)从外部传入。

const { Utterance } = require('../../../domain/speech/utterance');

// 全局层配置的作用域 id 占位:全局层只有一份,configStore 忽略此值。
const GLOBAL_SCOPE = 'global';

//// 把发言文本经译者转日语、经编排器合成,产出 base64 的 WAV [@busybee 2026-06-13] ////
async function synthesize(deps, text) {
  const { speechBackend, orchestrator, translate } = deps;
  if (!speechBackend || !speechBackend.isAvailable()) {
    return { success: false, error: 'TTS not available' };
  }
  let jaText = text;
  if (translate) jaText = await translate(text);

  const utterance = Utterance.of(jaText);
  orchestrator.synthesize(utterance);
  if (!utterance.hasAudio()) return { success: false, error: 'synthesis failed' };

  return { success: true, wav: utterance.audioAlignment.audio.toString('base64'), jaText };
}

//// 汇报后端初始化、可用、风格与译者就绪情况 [@busybee 2026-06-13] ////
function status(deps) {
  const { speechBackend, translate } = deps;
  const backend = speechBackend || {};
  return {
    initialized: backend.initialized || false,
    available: backend.isAvailable ? backend.isAvailable() : false,
    styleId: backend.styleId || 0,
    gpuMode: backend.isGpu || false,
    translationConfigured: !!translate,
  };
}

//// 释放并按持久化配置重新初始化后端,缺资源目录则报错 [@busybee 2026-06-13] ////
async function restart(deps) {
  const { speechBackend, configStore, resolveVoicevoxDir, fs } = deps;
  if (!speechBackend) return { success: false, error: 'TTS not available' };
  speechBackend.dispose();
  const voicevoxDir = resolveVoicevoxDir();
  if (!voicevoxDir || !fs.existsSync(voicevoxDir)) {
    return { success: false, error: 'voicevox_core not found' };
  }
  const config = (await configStore.read('global', GLOBAL_SCOPE)) || {};
  const tts = config.tts || {};
  const vvmFiles = tts.vvmFiles || ['0.vvm', '8.vvm'];
  const ok = speechBackend.init(voicevoxDir, vvmFiles, { gpuMode: !!tts.gpuMode });
  if (ok && config.tts) speechBackend.setConfig(config.tts);
  return { success: ok, error: ok ? undefined : 'init failed' };
}

//// 把风格与速度音高音量写入后端并持久化到全局配置 [@busybee 2026-06-13] ////
async function setConfig(deps, config) {
  const { speechBackend, configStore } = deps;
  if (!speechBackend || !config) return { success: true };
  speechBackend.setConfig(config);
  const stored = (await configStore.read('global', GLOBAL_SCOPE)) || {};
  stored.tts = {
    ...(stored.tts || {}),
    styleId: speechBackend.styleId,
    speedScale: speechBackend.speedScale,
    pitchScale: speechBackend.pitchScale,
    volumeScale: speechBackend.volumeScale,
  };
  await configStore.write('global', GLOBAL_SCOPE, stored);
  return { success: true };
}

//// 列出已加载语音的元数据 [@busybee 2026-06-13] ////
function getMetas(deps) {
  const { speechBackend } = deps;
  if (!speechBackend) return [];
  return speechBackend.getMetas();
}

//// 列出资源目录下可用的语音模型文件 [@busybee 2026-06-13] ////
function getAvailableVvms(deps) {
  const { speechBackend, resolveVoicevoxDir } = deps;
  if (!speechBackend) return [];
  return speechBackend.getAvailableVvms(resolveVoicevoxDir());
}

//// 重启应用以让重新初始化的后端在干净进程里生效 [@busybee 2026-06-13] ////
function relaunch(deps) {
  deps.relaunch();
  return { success: true };
}

//// 把全部 TTS 与安装通道经 ipc-router 注册到契约目录里的对应通道 [@busybee 2026-06-13] ////
function registerTtsHandlers(deps) {
  const { router, installer, resolveVoicevoxDir, notifyProgress } = deps;

  router.register('tts-synthesize', (text) => synthesize(deps, text));
  router.register('tts-get-status', () => status(deps));
  router.register('tts-restart', () => restart(deps));
  router.register('tts-set-config', (config) => setConfig(deps, config));
  router.register('tts-get-metas', () => getMetas(deps));
  router.register('tts-get-available-vvms', () => getAvailableVvms(deps));
  router.register('app-relaunch', () => relaunch(deps));
  router.register('download-vvm', (filename) => installer.downloadVvm(resolveVoicevoxDir(), filename));
  router.register('setup-voicevox', () => installer.setup(resolveVoicevoxDir(), notifyProgress));
}

module.exports = {
  registerTtsHandlers,
  synthesize,
  status,
  restart,
  setConfig,
  getMetas,
  getAvailableVvms,
};
