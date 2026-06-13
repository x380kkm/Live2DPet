// audience: internal
// # repository
// 仓储接口定义:键值与时间分层查询,调用方只依赖它。
// 不变量:调用方只见此接口,具体存储后端不越过实现文件。

class Repository {
  get(key) {
    throw new Error('未实现,见目标架构设计第七节迁移里程碑');
  }

  put(key, value) {
    throw new Error('未实现,见目标架构设计第七节迁移里程碑');
  }

  queryByTime(range) {
    throw new Error('未实现,见目标架构设计第七节迁移里程碑');
  }
}

module.exports = { Repository };
