// audience: internal
// # llm-client
// 统一 LLM 客户端:收口供应商细节与流式传输,业务侧只见这一个接口。
// 不变量:超时与重试在此一处配置;调用方拿到的是供应商无关的请求与响应,不见任何供应商 SDK 类型。

class LlmClient {
  // 发起一次补全请求,返回完整响应。
  complete(request) {
    throw new Error('未实现,见目标架构设计第七节迁移里程碑');
  }

  // 发起一次流式请求,逐块产出响应增量。
  stream(request) {
    throw new Error('未实现,见目标架构设计第七节迁移里程碑');
  }
}

module.exports = { LlmClient };
