// audience: internal
// # fewshot-resolver
// few-shot 解析器:解析意图的 few-shot 引用,经模板变量插槽受控注入语气。
// 不变量:语气只在插槽处注入,结构样例与成品句子不混写,守住与角色文风的隔离。

const NOT_IMPLEMENTED = '未实现,见目标架构设计第七节迁移里程碑';

class FewShotResolver {
  resolve(fewShotRefs, characterId) {
    throw new Error(NOT_IMPLEMENTED);
  }
}

module.exports = { FewShotResolver };
