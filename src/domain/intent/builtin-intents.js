// audience: internal
// # builtin-intents
// 出厂意图:观察回应、空闲闲聊两条核心意图的数据声明,供注册表加载。
// 不变量:出厂意图为纯数据声明;不含成品措辞、不含人格文本。

const NOT_IMPLEMENTED = '未实现,见目标架构设计第七节迁移里程碑';

function builtinIntents() {
  throw new Error(NOT_IMPLEMENTED);
}

module.exports = { builtinIntents };
