// audience: internal
// # machine-settings
// 用户级全局设置(模型接入、界面语言),与角色表现参数分开。
// 不变量:本文件只承载全局层键,角色表现参数不进此处。

class MachineSettings {
  get(key) {
    throw new Error('未实现,见目标架构设计第七节迁移里程碑');
  }

  set(key, value) {
    throw new Error('未实现,见目标架构设计第七节迁移里程碑');
  }
}

module.exports = { MachineSettings };
