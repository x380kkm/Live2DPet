// audience: internal
// # path-utils
// 路径集中抽象,打包态与开发态路径只算一处。
// 不变量:打包与开发态路径的差异只在本文件判定,调用方不重复判断。
//
// 构造注入 electron 的 app 与 node 的 path,第三方类型只在本文件出现。
// app 缺省时退回到本文件所在目录,便于在无 electron 的测试中运行。

//// 组装路径工具:注入 app 与 path,封装打包态判定 [@x380kkm 2026-06-13] ////
function createPathUtils(app, path) {
  const isPackaged = app ? app.isPackaged : false;

  //// 算应用资源根目录:打包态取安装目录,开发态取项目根 [@x380kkm 2026-06-13] ////
  function assetsDir() {
    if (!app) return __dirname;
    return app.getAppPath();
  }

  //// 算用户数据目录:可写持久化数据的落盘根 [@x380kkm 2026-06-13] ////
  function userDataDir() {
    if (!app) return __dirname;
    return app.getPath('userData');
  }

  //// 把存储键映射成用户数据目录下的绝对文件路径 [@x380kkm 2026-06-13] ////
  function resolve(key) {
    return path.join(userDataDir(), key);
  }

  return { isPackaged, assetsDir, userDataDir, resolve };
}

module.exports = { createPathUtils };
