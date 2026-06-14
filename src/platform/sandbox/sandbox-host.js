// audience: internal
// # sandbox-host
// 沙箱边界的公共接口:可执行 mod 前端跑在 iframe sandbox,坏 mod 不连累全局。
// 不变量:沙箱内拿不到 electronAPI;消息只放行白名单内的 api 调用,经 sandbox-bridge 收窄。

const ModExecutionMode = Object.freeze({
  // 选出厂前端模板加参数,零代码执行,无风险,默认。
  PureData: 'PureData',
  // 自定义可执行前端,跑在 iframe sandbox。
  Sandboxed: 'Sandboxed',
});

class SandboxHost {
  // 加载前端规格到 iframe sandbox,返回受限的沙箱框架句柄。
  host(frontendSpec) {
    throw new Error('未实现,见目标架构设计第七节迁移里程碑');
  }

  // 向沙箱内投递消息,经白名单。
  postMessage(msg) {
    throw new Error('未实现,见目标架构设计第七节迁移里程碑');
  }

  // 注册消息处理器,只放行白名单内的 api 调用。
  onMessage(handler) {
    throw new Error('未实现,见目标架构设计第七节迁移里程碑');
  }

  // 销毁沙箱框架并释放资源。
  dispose() {
    throw new Error('未实现,见目标架构设计第七节迁移里程碑');
  }
}

module.exports = { SandboxHost, ModExecutionMode };
