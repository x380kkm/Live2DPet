// audience: internal
// # voicevox-installer
// 安装时下载 VOICEVOX 官方资源:核心 DLL、ONNX 运行时、词典、默认模型。
// 不变量:官方资源的版本号、下载地址、解压后的目录结构只在本文件声明;voicevox-backend 只读这套目录,本文件只往里写。
// 构造注入:fs、path、runCommand(执行 curl/tar/powershell 等第三方命令)从外部传入,第三方进程调用只在此适配层出现。

// 官方资源版本号:与 voicevox-backend 期望的目录结构一一对应,升级在此一处改。
const CORE_VERSION = '0.16.3';
const ONNX_VERSION = '1.17.3';
const DICT_VERSION = '1.11';
// 单步下载的默认超时毫秒,词典源较慢单独放宽。
const DOWNLOAD_TIMEOUT_MS = 300000;

//// 声明一项官方资源:下载产物、解压后用于判定是否已装的标志文件、下载与解压步骤 [@busybee 2026-06-13] ////
function resourceCatalog(baseDir, path) {
  const cApiDir = path.join(baseDir, 'c_api');
  const modelsDir = path.join(baseDir, 'models');
  return {
    cApiDir,
    modelsDir,
    // 核心 DLL:解压到 c_api 下带版本号的子目录。
    core: {
      label: 'core',
      marker: path.join(cApiDir, `voicevox_core-windows-x64-${CORE_VERSION}`, 'lib', 'voicevox_core.dll'),
      archive: path.join(baseDir, `voicevox_core-windows-x64-${CORE_VERSION}.zip`),
      url: `https://github.com/VOICEVOX/voicevox_core/releases/download/${CORE_VERSION}/voicevox_core-windows-x64-${CORE_VERSION}.zip`,
      extract: 'zip',
      extractDir: cApiDir,
    },
    // CPU 版 ONNX 运行时。
    onnx: {
      label: 'onnx',
      marker: path.join(baseDir, `voicevox_onnxruntime-win-x64-${ONNX_VERSION}`, 'lib', 'voicevox_onnxruntime.dll'),
      archive: path.join(baseDir, `voicevox_onnxruntime-win-x64-${ONNX_VERSION}.tgz`),
      url: `https://github.com/VOICEVOX/onnxruntime-builder/releases/download/voicevox_onnxruntime-${ONNX_VERSION}/voicevox_onnxruntime-win-x64-${ONNX_VERSION}.tgz`,
      extract: 'tgz',
      extractDir: baseDir,
    },
    // DirectML(GPU)版 ONNX 运行时。
    dml: {
      label: 'dml',
      marker: path.join(baseDir, `voicevox_onnxruntime-win-x64-dml-${ONNX_VERSION}`, 'lib', 'voicevox_onnxruntime.dll'),
      archive: path.join(baseDir, `voicevox_onnxruntime-win-x64-dml-${ONNX_VERSION}.tgz`),
      url: `https://github.com/VOICEVOX/onnxruntime-builder/releases/download/voicevox_onnxruntime-${ONNX_VERSION}/voicevox_onnxruntime-win-x64-dml-${ONNX_VERSION}.tgz`,
      extract: 'tgz',
      extractDir: baseDir,
    },
    // Open JTalk 发音词典。
    dict: {
      label: 'dict',
      marker: path.join(baseDir, `open_jtalk_dic_utf_8-${DICT_VERSION}`),
      archive: path.join(baseDir, 'dict.tar.gz'),
      url: `https://sourceforge.net/projects/open-jtalk/files/Dictionary/open_jtalk_dic-${DICT_VERSION}/open_jtalk_dic_utf_8-${DICT_VERSION}.tar.gz/download`,
      extract: 'tgz',
      extractDir: baseDir,
    },
    // 默认语音模型:直接下载到 models 目录,无需解压。
    defaultVvm: {
      label: 'defaultVvm',
      marker: path.join(modelsDir, '0.vvm'),
      target: path.join(modelsDir, '0.vvm'),
      url: `https://github.com/VOICEVOX/voicevox_vvm/releases/download/${CORE_VERSION}/0.vvm`,
    },
  };
}
//// /声明一项官方资源 ////

//// 安装器:把官方资源下载并解压进 voicevox 目录,逐步上报进度 [@busybee 2026-06-13] ////
class VoicevoxInstaller {
  constructor({ fs, path, runCommand } = {}) {
    this.fs = fs;
    this.path = path;
    // runCommand(cmd, args, options) 返回 Promise,执行第三方命令并在失败时抛出。
    this.runCommand = runCommand;
  }

  //// 按某资源的产物地址用 curl 下载,再按解压方式落地 [@busybee 2026-06-13] ////
  async _downloadArchive(resource) {
    await this.runCommand('curl', ['-L', '-o', resource.archive, resource.url], { timeout: DOWNLOAD_TIMEOUT_MS });
    if (resource.extract === 'zip') {
      await this.runCommand('powershell', ['-Command',
        `Expand-Archive -Path "${resource.archive}" -DestinationPath "${resource.extractDir}" -Force`]);
    } else {
      await this.runCommand('tar', ['xzf', resource.archive, '-C', resource.extractDir]);
    }
    this.fs.unlinkSync(resource.archive);
  }
  //// /按某资源的产物地址用 curl 下载 ////

  //// 下载一个语音模型文件到 models 目录,文件名先校验、已存在则跳过 [@busybee 2026-06-13] ////
  async downloadVvm(voicevoxDir, filename) {
    const { fs, path } = this;
    if (!filename || !/^[\w.-]+\.vvm$/.test(filename)) {
      return { success: false, error: 'invalid filename' };
    }
    const modelsDir = path.join(voicevoxDir, 'models');
    if (!fs.existsSync(modelsDir)) fs.mkdirSync(modelsDir, { recursive: true });
    const target = path.join(modelsDir, filename);
    if (fs.existsSync(target)) return { success: true, message: 'already exists' };
    const url = `https://github.com/VOICEVOX/voicevox_vvm/releases/download/${CORE_VERSION}/${filename}`;
    try {
      await this.runCommand('curl', ['-L', '-o', target, url], { timeout: 120000 });
      return { success: true };
    } catch (err) {
      if (fs.existsSync(target)) fs.unlinkSync(target);
      return { success: false, error: err.message };
    }
  }
  //// /下载一个语音模型文件到 models 目录 ////

  //// 按目录现状逐项装齐官方资源:已装的跳过,缺的下载解压,经 notify 上报进度 [@busybee 2026-06-13] ////
  async setup(voicevoxDir, notify = () => {}) {
    const { fs, path } = this;
    const catalog = resourceCatalog(voicevoxDir, path);
    fs.mkdirSync(catalog.modelsDir, { recursive: true });
    fs.mkdirSync(catalog.cApiDir, { recursive: true });

    const archived = [catalog.core, catalog.onnx, catalog.dml, catalog.dict];
    try {
      for (const resource of archived) {
        if (fs.existsSync(resource.marker)) {
          notify({ step: resource.label, status: 'exists' });
          continue;
        }
        notify({ step: resource.label, status: 'downloading' });
        await this._downloadArchive(resource);
      }

      const vvm = catalog.defaultVvm;
      if (fs.existsSync(vvm.marker)) {
        notify({ step: vvm.label, status: 'exists' });
      } else {
        notify({ step: vvm.label, status: 'downloading' });
        await this.runCommand('curl', ['-L', '-o', vvm.target, vvm.url], { timeout: DOWNLOAD_TIMEOUT_MS });
      }

      notify({ step: 'done', status: 'done' });
      return { success: true, path: voicevoxDir };
    } catch (err) {
      notify({ step: 'fail', status: 'fail', error: err.message });
      return { success: false, error: err.message };
    }
  }
  //// /按目录现状逐项装齐官方资源 ////
}

module.exports = { VoicevoxInstaller, CORE_VERSION, ONNX_VERSION, DICT_VERSION };
