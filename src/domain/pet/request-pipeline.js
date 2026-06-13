// audience: internal
// # request-pipeline
// 可装配请求管线:收集启用的上下文源,按意图筛选与排序,组装提示词,调模型产出回应。
// 不变量:上下文源、过滤器、意图路由各为可重排可开关的阶段,管线自身不抓全局配置。

const NOT_IMPLEMENTED = '未实现,见目标架构设计第七节迁移里程碑';

class RequestPipeline {
  run(intent, scope) {
    throw new Error(NOT_IMPLEMENTED);
  }
}

module.exports = { RequestPipeline };
