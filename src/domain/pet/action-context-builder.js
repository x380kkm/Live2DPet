// audience: internal
// # action-context-builder
// 把命名上下文源按意图引用收集后交组装器拼成一段上下文文本,供决策器陈述当前态势。
// 不变量:纯逻辑无副作用;意图为空时取全部源(给不限定意图的合并决策用),否则只取该意图声明引用的源。

const { ContextAssembler } = require('./context-source');

//// 按意图的源引用从源数组取出对应源,意图为空时取全部源 [@busybee 2026-06-14] ////
function collectSources(sources, intent) {
  if (!intent) {
    return sources.slice();
  }
  const refs = intent.contextSourceRefs || [];
  const byId = new Map(sources.map((source) => [source.id, source]));
  const collected = [];
  for (const ref of refs) {
    const source = byId.get(ref);
    if (source) {
      collected.push(source);
    }
  }
  return collected;
}
//// /按意图的源引用取出对应源 ////

//// 造一个上下文构造函数:收集源、组装、回拼好的上下文文本 [@busybee 2026-06-14] ////
// sources 为命名上下文源数组;budget 为 token 预算上限;assembler 缺省用默认 ContextAssembler。
function makeContextBuilder({ sources, assembler, budget } = {}) {
  const list = Array.isArray(sources) ? sources : [];
  const compose = assembler || new ContextAssembler();
  return (intent, scope) => {
    const picked = collectSources(list, intent);
    return compose.assemble(picked, scope, budget).text;
  };
}
//// /造一个上下文构造函数 ////

module.exports = { makeContextBuilder, collectSources };
