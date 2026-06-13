// audience: internal
// # path-utils
// 路径集中抽象,打包态与开发态路径只算一处。
// 不变量:打包与开发态路径的差异只在本文件判定,调用方不重复判断。

function assetsDir() {
  throw new Error('未实现,见目标架构设计第七节迁移里程碑');
}

function userDataDir() {
  throw new Error('未实现,见目标架构设计第七节迁移里程碑');
}

function resolve(key) {
  throw new Error('未实现,见目标架构设计第七节迁移里程碑');
}

module.exports = { assetsDir, userDataDir, resolve };
