// audience: internal
// # stage-boot
// 角色舞台渲染进程的组合根:从 preload 暴露的窄接口取依赖,构造注入给 stage 与设置面板。
// 不变量:渲染侧只经此处装配,业务模块从不直接抓全局,只见构造注入的接口。

export function bootStage(narrowApi) {
  throw new Error('未实现,见目标架构设计第七节迁移里程碑');
}
