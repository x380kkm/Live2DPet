// audience: internal
// # mod-introduction
// 把刚挂载的临时 mod 折成一段中性引入上下文,供富管线据人格现场产出一句引入台词。
// 不变量:只取 mod 的行为面(它会产出哪些交互事件),绝不取人格或成品措辞;mod 本就无措辞,这里也不造。

//// 把一个 mod 折成中性引入上下文:只述其交互行为,要求按人格现场介绍 [@busybee 2026-06-14] ////
// 引入台词由主模型据人格现场生成,本函数只给中性事实(会响应哪些交互)与一句生成指引,不含任何成品措辞。
function describeModNeutrally(mod) {
  if (!mod) {
    return '';
  }
  const emits = Array.isArray(mod.emits) && mod.emits.length ? mod.emits.join('、') : '';
  const behavior = emits ? `它会响应这些交互:${emits}。` : '它是一个新的小互动。';
  return `你刚为自己添置了一个新的互动小玩意。${behavior}用一句符合你人格的话,自然地向用户介绍它的存在,不要照搬任何现成措辞。`;
}
//// /把一个 mod 折成中性引入上下文 ////

module.exports = { describeModNeutrally };
