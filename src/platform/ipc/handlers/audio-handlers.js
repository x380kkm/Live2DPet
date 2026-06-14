// audience: internal
// # audio-handlers
// 预合成默认音频片段的生成与加载处理器:开机问候等固定短语在此预先合成落盘、按需读回。
// 合成走 speechBackend,落盘走注入的目录与 fs,短语列表持久化经 configStore。
// 不变量:本文件不写裸通道名(经 ipc-router 校验),不直接判定打包态路径,默认音频目录由 resolveDefaultAudioDir 注入。
// 构造注入:router(ipc-router)、speechBackend(逐短语合成)、configStore(持久化短语列表)、resolveDefaultAudioDir(算落盘目录)、fs、path 从外部传入。

// 全局层配置的作用域 id 占位:全局层只有一份,configStore 忽略此值。
const GLOBAL_SCOPE = 'global';
// 预合成片段文件名前缀,按短语序号编号。
const CLIP_PREFIX = 'default_';

//// 清空目录下已有的 WAV 片段,使每次生成都是全量重写 [@busybee 2026-06-13] ////
function clearClips(fs, path, audioDir) {
  for (const name of fs.readdirSync(audioDir)) {
    if (name.endsWith('.wav')) fs.unlinkSync(path.join(audioDir, name));
  }
}

//// 用指定风格逐条合成默认短语并写成 WAV 文件,合成后恢复原风格 [@busybee 2026-06-13] ////
async function generate(deps, phrases, styleId) {
  const { speechBackend, configStore, resolveDefaultAudioDir, fs, path } = deps;
  if (!speechBackend || !speechBackend.isAvailable()) {
    return { success: false, error: 'TTS not available' };
  }
  const audioDir = resolveDefaultAudioDir();
  if (!fs.existsSync(audioDir)) fs.mkdirSync(audioDir, { recursive: true });
  clearClips(fs, path, audioDir);

  const previousStyleId = speechBackend.styleId;
  if (styleId !== undefined) speechBackend.styleId = styleId;
  const results = [];
  for (let i = 0; i < phrases.length; i++) {
    const phrase = phrases[i];
    try {
      const wav = speechBackend.synthesize(phrase);
      if (wav) {
        const file = `${CLIP_PREFIX}${i}.wav`;
        fs.writeFileSync(path.join(audioDir, file), wav);
        results.push({ phrase, file, success: true });
      } else {
        results.push({ phrase, success: false });
      }
    } catch (err) {
      results.push({ phrase, success: false, error: err.message });
    }
  }
  speechBackend.styleId = previousStyleId;

  const stored = (await configStore.read('global', GLOBAL_SCOPE)) || {};
  stored.tts = { ...(stored.tts || {}), defaultPhrases: phrases };
  await configStore.write('global', GLOBAL_SCOPE, stored);
  return { success: true, results };
}
//// /用指定风格逐条合成默认短语 ////

//// 读回目录下全部预合成片段,每个转成 base64 [@busybee 2026-06-13] ////
function load(deps) {
  const { resolveDefaultAudioDir, fs, path } = deps;
  const audioDir = resolveDefaultAudioDir();
  if (!fs.existsSync(audioDir)) return { success: true, files: [] };
  const files = fs.readdirSync(audioDir)
    .filter((name) => name.endsWith('.wav'))
    .map((name) => ({
      name,
      base64: fs.readFileSync(path.join(audioDir, name)).toString('base64'),
    }));
  return { success: true, files };
}

//// 把默认音频的生成与加载通道经 ipc-router 注册到契约目录里的对应通道 [@busybee 2026-06-13] ////
// generate-default-audio 为多参通道,沿用 ipc-router 约定:payload 为 [phrases, styleId] 位置数组。
function registerAudioHandlers(deps) {
  const { router } = deps;
  router.register('generate-default-audio', (payload) => generate(deps, payload[0], payload[1]));
  router.register('load-default-audio', () => load(deps));
}

module.exports = { registerAudioHandlers, generate, load };
