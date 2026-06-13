// audience: internal
// # screen-source
// 把 desktopCapturer、powerMonitor、screen 包成自有屏幕与空闲查询接口。
// 不变量:electron 的 desktopCapturer、powerMonitor、screen 类型不越过本文件。

function captureScreen(options) {
  throw new Error('未实现,见目标架构设计第七节迁移里程碑');
}

function idleTime() {
  throw new Error('未实现,见目标架构设计第七节迁移里程碑');
}

function screenLayout() {
  throw new Error('未实现,见目标架构设计第七节迁移里程碑');
}

module.exports = { captureScreen, idleTime, screenLayout };
