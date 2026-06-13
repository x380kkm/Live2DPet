// audience: internal
// # window-factory
// 把 BrowserWindow 的创建与存活判断包成自有 Window 句柄,业务侧只见此接口。
// 不变量:electron 的 BrowserWindow 类型不越过本文件,业务侧从不直接 new。

function createWindow(options) {
  throw new Error('未实现,见目标架构设计第七节迁移里程碑');
}

function isAlive(handle) {
  throw new Error('未实现,见目标架构设计第七节迁移里程碑');
}

module.exports = { createWindow, isAlive };
