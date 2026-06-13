// audience: internal
// # mod
// mod 数据结构与运行时:可复用的可交互前端规格,前端层加意图层加交互事件契约加对外 api 协议。
// 不变量:官方与用户 mod 结构相同仅信任级别不同;mod 只表达怎么交互,系统副作用留宿主。
//
// Mod 是纯数据模板:frontendSpec 描述前端长什么样、emits 声明它会产出哪些交互事件名、
// intents 是随它一起被发现注入的意图声明、hostApi 是它要求宿主提供的方法名清单。
// ModRuntime 把一个 mod 挂到舞台上,前端通过 emit 产出交互事件经注入的发布器送上事件总线;
// 取代旧 desktop-pet-system 里窗口直发命中、核心 _buildHitContext 缓冲并拼装提示词的硬编码路径。

const { InteractionEvent, isInteractionEvent } = require('./interaction-event');

// 两种信任级别:出厂 mod 与用户自定义 mod 结构相同,仅此字段不同。
const TRUST = Object.freeze({ OFFICIAL: 'Official', USER_CUSTOM: 'UserCustom' });

class Mod {
  //// 用一份纯数据规格构造一个可复用 mod 模板 [@busybee 2026-06-13] ////
  constructor(spec) {
    const data = spec || {};
    // mod 标识
    this.id = data.id || null;
    // 信任级别:Official 或 UserCustom
    this.trust = data.trust || TRUST.USER_CUSTOM;
    // 前端层规格:HTML/CSS/JS,可执行则标记 sandboxed
    this.frontendSpec = data.frontendSpec || null;
    // 前端会产出的交互事件名清单,意图据此声明消费
    this.emits = Array.isArray(data.emits) ? data.emits.slice() : [];
    // 注册的意图清单,0 到多个,加载期随 mod 被发现注入
    this.intents = Array.isArray(data.intents) ? data.intents.slice() : [];
    // 注入角色 AI 让前端能与角色交互的提示词角色
    this.injectedPromptRole = data.injectedPromptRole || null;
    // 此 mod 要求宿主提供的方法名清单,挂载时据此筛出受限 api 视图
    this.hostApi = Array.isArray(data.hostApi) ? data.hostApi.slice() : [];
    // mod 自带配置
    this.config = data.config || null;
  }

  //// 判断此 mod 是否为出厂信任级别 [@busybee 2026-06-13] ////
  isOfficial() {
    return this.trust === TRUST.OFFICIAL;
  }
}

class ModRuntime {
  //// 用一个 mod 与发布交互事件的发布器构造运行时 [@busybee 2026-06-13] ////
  // publishEvent 是注入的发布函数(实为事件总线的 publish),运行时不直接持有总线实例。
  constructor(mod, publishEvent) {
    this.mod = mod;
    this._publishEvent = publishEvent;
    this._stage = null;
    // 仅暴露 mod 声明的方法的宿主 api 受限视图,挂载时填充。
    this._api = null;
    this._mounted = false;
  }

  //// 把 mod 挂到舞台上,只放行其声明的宿主方法 [@busybee 2026-06-13] ////
  // stage 是前端层提供的挂载点;api 是完整宿主 api,运行时按 mod.hostApi 收窄后交给前端。
  mount(stage, api) {
    this._stage = stage;
    this._api = this._restrictApi(api);
    this._mounted = true;
    return { stage: this._stage, api: this._api, frontendSpec: this.mod.frontendSpec };
  }

  //// 把前端产出的交互事件经注入发布器送上总线 [@busybee 2026-06-13] ////
  // name 是交互事件名,payload 是交互语义数据;只搬运交互语义,不在此执行任何宿主副作用。
  emit(name, payload) {
    if (!this._mounted) {
      throw new Error('mod 未挂载,不能产出交互事件');
    }
    const event = new InteractionEvent(name, payload);
    if (!isInteractionEvent(event)) {
      throw new Error('交互事件名缺失或非法');
    }
    this._publishEvent(event);
    return event;
  }

  //// 卸载 mod,清空舞台与受限 api 引用 [@busybee 2026-06-13] ////
  dispose() {
    this._stage = null;
    this._api = null;
    this._mounted = false;
  }

  //// 按 mod 声明的方法名从完整宿主 api 里筛出受限视图 [@busybee 2026-06-13] ////
  // mod 没声明的方法一律不放行,前端只能调到它声明过的能力。
  _restrictApi(api) {
    const full = api || {};
    const restricted = {};
    for (const name of this.mod.hostApi) {
      if (typeof full[name] === 'function') {
        restricted[name] = full[name].bind(full);
      }
    }
    return restricted;
  }
}

module.exports = { Mod, ModRuntime, TRUST };
