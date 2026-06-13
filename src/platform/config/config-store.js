// audience: internal
// # config-store
// 配置持久化适配:经 storage 仓储读写,字段加密只声明一处。
// 不变量:配置只经 storage 仓储落盘,本文件不直接碰文件系统。

class ConfigStore {
  read(layer, scopeId) {
    throw new Error('未实现,见目标架构设计第七节迁移里程碑');
  }

  write(layer, scopeId, value) {
    throw new Error('未实现,见目标架构设计第七节迁移里程碑');
  }
}

module.exports = { ConfigStore };
