// 运行方式:node --test tests/platform/handlers/voicevox-installer.test.js
// 用 mock 注入 fs、path、runCommand,断言:已装资源跳过、缺失资源逐项下载解压并删归档、
// 进度逐步上报、命令失败归一成失败对象、下载模型校验文件名且已存在则跳过。

const { test } = require('node:test');
const assert = require('node:assert');
const { VoicevoxInstaller } = require('../../../src/platform/speech/voicevox-installer');

//// 假 path.join:正斜杠拼接,便于断言路径片段 [@x380kkm 2026-06-13] ////
const fakePath = { join: (...parts) => parts.join('/') };

//// 假 fs:按一组已存在路径判定 existsSync,记录建目录、删文件、写文件 [@x380kkm 2026-06-13] ////
function fakeFs(existing = []) {
  const present = new Set(existing);
  const calls = { mkdir: [], unlink: [], written: [] };
  return {
    present,
    calls,
    existsSync: (p) => present.has(p),
    mkdirSync: (dir) => { calls.mkdir.push(dir); present.add(dir); },
    unlinkSync: (p) => { calls.unlink.push(p); present.delete(p); },
    writeFileSync: (p, data) => { calls.written.push({ p, data }); present.add(p); },
    readdirSync: () => [],
  };
}

//// 假 runCommand:记录每次调用,默认成功,可指定某命令抛错 [@x380kkm 2026-06-13] ////
function fakeRun(failOn = null) {
  const calls = [];
  const run = async (cmd, args) => {
    calls.push({ cmd, args });
    if (failOn && failOn(cmd, args)) throw new Error('command failed');
  };
  return { run, calls };
}

//// 资源全已装时 setup 不下载任何东西,每项上报 exists [@x380kkm 2026-06-13] ////
test('setup skips every resource that already exists', async () => {
  const fs = fakeFs([
    '/vv/c_api/voicevox_core-windows-x64-0.16.3/lib/voicevox_core.dll',
    '/vv/voicevox_onnxruntime-win-x64-1.17.3/lib/voicevox_onnxruntime.dll',
    '/vv/voicevox_onnxruntime-win-x64-dml-1.17.3/lib/voicevox_onnxruntime.dll',
    '/vv/open_jtalk_dic_utf_8-1.11',
    '/vv/models/0.vvm',
  ]);
  const { run, calls } = fakeRun();
  const installer = new VoicevoxInstaller({ fs, path: fakePath, runCommand: run });
  const progress = [];
  const result = await installer.setup('/vv', (p) => progress.push(p));

  assert.deepStrictEqual(result, { success: true, path: '/vv' });
  assert.strictEqual(calls.length, 0);
  assert.ok(progress.every((p) => p.status === 'exists' || p.status === 'done'));
});

//// 缺失的归档资源走 curl 下载、按 zip/tgz 解压、删归档 [@x380kkm 2026-06-13] ////
test('setup downloads, extracts and deletes archives for missing resources', async () => {
  const fs = fakeFs();
  const { run, calls } = fakeRun();
  const installer = new VoicevoxInstaller({ fs, path: fakePath, runCommand: run });
  const result = await installer.setup('/vv', () => {});

  assert.strictEqual(result.success, true);
  // core 用 powershell 解压 zip,onnx/dml/dict 用 tar 解压 tgz
  assert.ok(calls.some((c) => c.cmd === 'powershell'));
  assert.ok(calls.some((c) => c.cmd === 'tar'));
  // 每个归档下载后被删除
  assert.ok(fs.calls.unlink.some((p) => p.endsWith('.zip')));
  assert.ok(fs.calls.unlink.some((p) => p.endsWith('.tgz')));
});

//// 缺失的默认模型走 curl 下载到 models 目录,不解压不删 [@x380kkm 2026-06-13] ////
test('setup downloads the default vvm without extracting', async () => {
  const fs = fakeFs([
    '/vv/c_api/voicevox_core-windows-x64-0.16.3/lib/voicevox_core.dll',
    '/vv/voicevox_onnxruntime-win-x64-1.17.3/lib/voicevox_onnxruntime.dll',
    '/vv/voicevox_onnxruntime-win-x64-dml-1.17.3/lib/voicevox_onnxruntime.dll',
    '/vv/open_jtalk_dic_utf_8-1.11',
  ]);
  const { run, calls } = fakeRun();
  const installer = new VoicevoxInstaller({ fs, path: fakePath, runCommand: run });
  await installer.setup('/vv', () => {});

  const vvmDl = calls.find((c) => c.cmd === 'curl' && c.args.includes('/vv/models/0.vvm'));
  assert.ok(vvmDl, '应当 curl 下载默认模型到 models/0.vvm');
  assert.strictEqual(calls.filter((c) => c.cmd === 'tar' || c.cmd === 'powershell').length, 0);
});

//// 安装进度逐步上报,首步下载到末步完成 [@x380kkm 2026-06-13] ////
test('setup reports progress per step ending with done', async () => {
  const fs = fakeFs();
  const { run } = fakeRun();
  const installer = new VoicevoxInstaller({ fs, path: fakePath, runCommand: run });
  const progress = [];
  await installer.setup('/vv', (p) => progress.push(p));

  assert.ok(progress.some((p) => p.step === 'core' && p.status === 'downloading'));
  assert.strictEqual(progress[progress.length - 1].status, 'done');
});

//// 某步命令失败时 setup 归一成失败对象并上报 fail [@x380kkm 2026-06-13] ////
test('setup returns a failure object and reports fail when a command throws', async () => {
  const fs = fakeFs();
  const { run } = fakeRun((cmd) => cmd === 'powershell');
  const installer = new VoicevoxInstaller({ fs, path: fakePath, runCommand: run });
  const progress = [];
  const result = await installer.setup('/vv', (p) => progress.push(p));

  assert.strictEqual(result.success, false);
  assert.match(result.error, /command failed/);
  assert.ok(progress.some((p) => p.status === 'fail'));
});

//// downloadVvm 拒绝非法文件名,不触发下载 [@x380kkm 2026-06-13] ////
test('downloadVvm rejects an invalid filename without downloading', async () => {
  const fs = fakeFs();
  const { run, calls } = fakeRun();
  const installer = new VoicevoxInstaller({ fs, path: fakePath, runCommand: run });
  const result = await installer.downloadVvm('/vv', '../evil.vvm');
  assert.strictEqual(result.success, false);
  assert.strictEqual(calls.length, 0);
});

//// downloadVvm 对已存在的模型直接返回成功不重下 [@x380kkm 2026-06-13] ////
test('downloadVvm skips a model that already exists', async () => {
  const fs = fakeFs(['/vv/models', '/vv/models/8.vvm']);
  const { run, calls } = fakeRun();
  const installer = new VoicevoxInstaller({ fs, path: fakePath, runCommand: run });
  const result = await installer.downloadVvm('/vv', '8.vvm');
  assert.strictEqual(result.success, true);
  assert.strictEqual(result.message, 'already exists');
  assert.strictEqual(calls.length, 0);
});

//// downloadVvm 下载失败时清掉半成品并报错 [@x380kkm 2026-06-13] ////
test('downloadVvm cleans up the partial file and reports error on failure', async () => {
  const fs = fakeFs(['/vv/models']);
  const { run } = fakeRun((cmd) => cmd === 'curl');
  const installer = new VoicevoxInstaller({ fs, path: fakePath, runCommand: run });
  const result = await installer.downloadVvm('/vv', '8.vvm');
  assert.strictEqual(result.success, false);
  assert.match(result.error, /command failed/);
});
