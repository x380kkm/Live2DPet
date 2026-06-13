// audience: internal
// # context-source
// 上下文源接口与组装器:命名上下文源声明优先级与 token 预算,组装器按优先级排序累加到预算截断。
// 不变量:每个源以引用接入意图、不内联内容;render 返回 null 的源在组装时被跳过。

const NOT_IMPLEMENTED = '未实现,见目标架构设计第七节迁移里程碑';

class ContextSource {
  get id() {
    throw new Error(NOT_IMPLEMENTED);
  }

  get priority() {
    throw new Error(NOT_IMPLEMENTED);
  }

  estimateTokens() {
    throw new Error(NOT_IMPLEMENTED);
  }

  render(scope) {
    throw new Error(NOT_IMPLEMENTED);
  }
}

class ContextAssembler {
  assemble(sources, budget) {
    throw new Error(NOT_IMPLEMENTED);
  }
}

module.exports = { ContextSource, ContextAssembler };
