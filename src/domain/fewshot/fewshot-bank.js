// audience: internal
// # fewshot-bank
// few-shot 银行:按名字组织的可替换样例库,结构样例全局共享、语气样例按角色,经模板变量插槽受控合并。
// 不变量:结构与语气各自存储互不可见;样例不得含成品句子,校验点设在入库时。

const NOT_IMPLEMENTED = '未实现,见目标架构设计第七节迁移里程碑';

class FewShotBank {
  resolveStructure(ref) {
    throw new Error(NOT_IMPLEMENTED);
  }

  resolveTone(ref, characterId) {
    throw new Error(NOT_IMPLEMENTED);
  }

  compose(structure, tone, slots) {
    throw new Error(NOT_IMPLEMENTED);
  }
}

module.exports = { FewShotBank };
