// audience: internal
// # settings-app
// 设置面板:按领域拆分的子面板装配,以配置数据模型为真相来源而非 DOM 现场抓取。
// 不变量:真相来源是配置数据模型;读写配置经能力网关,面板不直接抓全局。

export class SettingsApp {
  mount(narrowApi) {
    throw new Error('未实现,见目标架构设计第七节迁移里程碑');
  }

  load() {
    throw new Error('未实现,见目标架构设计第七节迁移里程碑');
  }

  save() {
    throw new Error('未实现,见目标架构设计第七节迁移里程碑');
  }
}
