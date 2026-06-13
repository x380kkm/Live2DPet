// audience: internal
// # mod
// mod 数据结构与运行时:可复用的可交互前端规格,前端层加意图层加交互事件契约加对外 api 协议。
// 不变量:官方与用户 mod 结构相同仅信任级别不同;mod 只表达怎么交互,系统副作用留宿主。

const NOT_IMPLEMENTED = '未实现,见目标架构设计第七节迁移里程碑';

class Mod {
  constructor() {
    // mod 标识
    this.id = null;
    // 信任级别:Official 或 UserCustom
    this.trust = null;
    // 前端层规格:HTML/CSS/JS,可执行则标记 sandboxed
    this.frontendSpec = null;
    // 注册的意图清单,0 到多个
    this.intents = [];
    // 注入角色 AI 让前端能与角色交互的提示词角色
    this.injectedPromptRole = null;
    // mod 自带配置
    this.config = null;
  }
}

class ModRuntime {
  mount(stage, api) {
    throw new Error(NOT_IMPLEMENTED);
  }

  emit(event) {
    throw new Error(NOT_IMPLEMENTED);
  }

  dispose() {
    throw new Error(NOT_IMPLEMENTED);
  }
}

module.exports = { Mod, ModRuntime };
