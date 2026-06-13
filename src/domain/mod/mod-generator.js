// audience: internal
// # mod-generator
// mod 生成器:生成期 LLM 造前端与行为,产出一份 mod 模板。
// 不变量:产物只含行为与前端,禁止写入人格或成品措辞,守住用户数据与系统行为隔离边界。

const NOT_IMPLEMENTED = '未实现,见目标架构设计第七节迁移里程碑';

class ModGenerator {
  generate(spec) {
    throw new Error(NOT_IMPLEMENTED);
  }
}

module.exports = { ModGenerator };
