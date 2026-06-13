// 运行: node --test tests/platform/path-utils.test.js
// 用 mock 注入 app 与 path,断言打包态判定只在本模块发生、键到绝对路径的映射正确。

const { test } = require('node:test');
const assert = require('node:assert');
const { createPathUtils } = require('../../src/platform/storage/path-utils');

//// 用记录调用的假 path,断言 join 拼接行为 [@busybee 2026-06-13] ////
function fakePath() {
  return { join: (...parts) => parts.join('/') };
}

//// 构造一个打包态 app:assetsDir 取安装目录,userDataDir 取 userData [@busybee 2026-06-13] ////
function packagedApp() {
  return {
    isPackaged: true,
    getAppPath: () => '/install/app',
    getPath: (name) => (name === 'userData' ? '/user/data' : `/${name}`)
  };
}

test('isPackaged 直接反映注入的 app.isPackaged', () => {
  const packaged = createPathUtils(packagedApp(), fakePath());
  assert.strictEqual(packaged.isPackaged, true);

  const devApp = { ...packagedApp(), isPackaged: false };
  const dev = createPathUtils(devApp, fakePath());
  assert.strictEqual(dev.isPackaged, false);
});

test('assetsDir 返回 app 的应用资源根', () => {
  const utils = createPathUtils(packagedApp(), fakePath());
  assert.strictEqual(utils.assetsDir(), '/install/app');
});

test('userDataDir 返回 app 的 userData 目录', () => {
  const utils = createPathUtils(packagedApp(), fakePath());
  assert.strictEqual(utils.userDataDir(), '/user/data');
});

test('resolve 把键拼到 userData 目录下', () => {
  const utils = createPathUtils(packagedApp(), fakePath());
  assert.strictEqual(utils.resolve('config.json'), '/user/data/config.json');
});

test('app 缺省时退回本模块目录,不抛错', () => {
  const utils = createPathUtils(null, fakePath());
  assert.strictEqual(utils.isPackaged, false);
  assert.strictEqual(typeof utils.assetsDir(), 'string');
  assert.strictEqual(typeof utils.userDataDir(), 'string');
});
