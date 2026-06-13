// audience: internal
// # tray-factory
// 把 Tray 与 Menu 的构建包成自有托盘接口,业务侧只见此接口。
// 不变量:electron 的 Tray 与 Menu 类型不越过本文件。

function createTray(spec) {
  throw new Error('未实现,见目标架构设计第七节迁移里程碑');
}

module.exports = { createTray };
