// audience: internal
// # file-repository
// 仓储接口的文件实现:异步 I/O,经 path-utils 算路径。
// 不变量:本文件只经 path-utils 取路径,不内联路径字面量。

const { Repository } = require('./repository');

class FileRepository extends Repository {
  async get(key) {
    throw new Error('未实现,见目标架构设计第七节迁移里程碑');
  }

  async put(key, value) {
    throw new Error('未实现,见目标架构设计第七节迁移里程碑');
  }

  async queryByTime(range) {
    throw new Error('未实现,见目标架构设计第七节迁移里程碑');
  }
}

module.exports = { FileRepository };
