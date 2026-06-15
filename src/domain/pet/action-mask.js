// audience: internal
// # action-mask
// 动作屏蔽钩子:在选择动作之前按情境抑制某些候选。本版只落钩子的形状与位置,默认全通过;
// 专注场景、连续交互场景等的抑制规则后续在此补。
// 不变量:纯函数无副作用;返回候选的子集,不改候选对象本身;无规则时原样返回。

//// 默认屏蔽:不抑制任何候选,原样返回 [@x380kkm 2026-06-14] ////
function identityMask(candidates) {
  return candidates || [];
}
//// /默认屏蔽 ////

//// 把若干屏蔽规则顺序串成一个:每条规则取候选的子集 [@x380kkm 2026-06-14] ////
// 每条规则形如 (candidates, scope) => candidates 的子集;按顺序逐条收窄。
function composeMasks(rules) {
  const list = Array.isArray(rules) ? rules : [];
  return (candidates, scope) => list.reduce((current, rule) => rule(current, scope), candidates || []);
}
//// /把若干屏蔽规则顺序串成一个 ////

module.exports = { identityMask, composeMasks };
