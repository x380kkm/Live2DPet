// audience: internal
// # install-live2d-sample
// 安装期脚本:出示 Live2D 授权条款,用户接受后从官方 CubismWebSamples 下载一个运行时样例作默认角色。
// 不变量:不打包不再分发,仅安装期运行;未接受条款不下载;只取指定样例目录下的运行时文件,保留其内部相对结构。

const https = require('https');
const fs = require('fs');
const path = require('path');

const REPO = 'Live2D/CubismWebSamples';
const LICENSE_URL = 'https://www.live2d.com/eula/live2d-free-material-license-agreement_en.html';
const LICENSE_NOTICE = '默认角色来自 Live2D 官方样例(CubismWebSamples),受 Live2D Free Material License Agreement 约束。\n下载即表示你以个人用户身份接受该条款:' + LICENSE_URL + '\n本软件不打包、不再分发这些样例,仅在你接受后从官方仓库为你下载。';

//// 出示授权条款,供安装流程在下载前给用户看 [@busybee 2026-06-13] ////
function presentLicense() {
  return { url: LICENSE_URL, notice: LICENSE_NOTICE };
}

//// 跟随重定向取一个 URL 的字节;GitHub 要求带 User-Agent [@busybee 2026-06-13] ////
function fetchBuffer(url, redirectsLeft = 5) {
  return new Promise((resolve, reject) => {
    https.get(url, { headers: { 'User-Agent': 'Live2DPet-Installer' } }, (res) => {
      if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
        res.resume();
        if (redirectsLeft <= 0) { reject(new Error('重定向过多')); return; }
        resolve(fetchBuffer(res.headers.location, redirectsLeft - 1));
        return;
      }
      if (res.statusCode !== 200) { res.resume(); reject(new Error('HTTP ' + res.statusCode + ' ' + url)); return; }
      const chunks = [];
      res.on('data', (c) => chunks.push(c));
      res.on('end', () => resolve(Buffer.concat(chunks)));
    }).on('error', reject);
  });
}

async function fetchJson(url) {
  return JSON.parse((await fetchBuffer(url)).toString('utf-8'));
}

//// 经 GitHub 递归 tree 列出某样例目录下的全部运行时文件 [@busybee 2026-06-13] ////
async function listModelFiles(model) {
  const repo = await fetchJson('https://api.github.com/repos/' + REPO);
  const branch = repo.default_branch;
  const tree = await fetchJson('https://api.github.com/repos/' + REPO + '/git/trees/' + branch + '?recursive=1');
  const marker = '/Resources/' + model + '/';
  const files = tree.tree.filter((n) => n.type === 'blob' && n.path.includes(marker)).map((n) => n.path);
  if (files.length === 0) throw new Error('样例未找到:' + model);
  return { branch, files, marker };
}

//// 下载样例运行时文件到目标目录,保留样例内相对结构 [@busybee 2026-06-13] ////
async function downloadSampleRuntime(model, destDir) {
  const { branch, files, marker } = await listModelFiles(model);
  for (const p of files) {
    const rel = p.slice(p.indexOf(marker) + marker.length);
    const out = path.join(destDir, rel);
    fs.mkdirSync(path.dirname(out), { recursive: true });
    fs.writeFileSync(out, await fetchBuffer('https://raw.githubusercontent.com/' + REPO + '/' + branch + '/' + p));
  }
  return files.length;
}
//// /下载样例运行时文件到目标目录 ////

//// 安装默认样例:未接受条款则只出示不下载 [@busybee 2026-06-13] ////
async function installLive2dSample(options) {
  const opts = options || {};
  const model = opts.model || 'Hiyori';
  const destDir = opts.destDir;
  const log = opts.log || (() => {});
  const license = presentLicense();
  if (!opts.accepted) return { downloaded: false, license };
  log('下载 Live2D 样例 ' + model + ' 到 ' + destDir);
  const fileCount = await downloadSampleRuntime(model, destDir);
  log('完成,共 ' + fileCount + ' 个文件');
  return { downloaded: true, model, destDir, fileCount, license };
}
//// /安装默认样例 ////

module.exports = { installLive2dSample, presentLicense };

//// 直接运行:node scripts/install-live2d-sample.js --model Hiyori --dest <目录> --accept [@busybee 2026-06-13] ////
if (require.main === module) {
  const args = process.argv.slice(2);
  const get = (key, fallback) => { const i = args.indexOf(key); return i >= 0 && args[i + 1] ? args[i + 1] : fallback; };
  const model = get('--model', 'Hiyori');
  const destDir = get('--dest', path.join(__dirname, '..', 'models', model));
  const accepted = args.includes('--accept') || process.env.LIVE2D_LICENSE_ACCEPTED === '1';
  installLive2dSample({ model, destDir, accepted, log: (m) => console.log('[install-live2d] ' + m) })
    .then((r) => {
      if (!r.downloaded) { console.log('未接受授权,未下载。\n' + r.license.notice); process.exit(2); }
      process.exit(0);
    })
    .catch((e) => { console.error('安装失败:', (e && e.message) || e); process.exit(1); });
}
//// /直接运行入口 ////
