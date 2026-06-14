// audience: internal
// # fewshot-resolver
// few-shot 解析器:解析意图的 few-shot 引用,经模板变量插槽受控注入语气。
// 不变量:语气只在插槽处注入,结构样例与成品句子不混写,守住与角色文风的隔离。
//
// 引用是纯数据,按形状分两类:
//   结构引用 { structure, tone?, slots? }(或字符串即结构名):先取全局结构骨架,再取本角色语气样例,
//     经 bank.compose 在插槽处注入语气,产出样例轮次;语气跨角色不可见,缺该语气时只留空骨架。
//   场景台词引用 { sceneSet, options? }:取本角色的场景台词样例,经 bank.composeSceneTurns 渲染成示例轮次,
//     其轮次携带成品台词(语气示范主体),供模型模仿文风但不照抄(指令在 prompt-composer)。

class FewShotResolver {
  //// 构造注入 few-shot 银行,解析器自身不持有样例 [@busybee 2026-06-13] ////
  constructor(bank) {
    this._bank = bank;
  }

  //// 解析一组引用,按角色注入语气,产出展平的样例轮次 [@busybee 2026-06-13] ////
  // 结构缺失的引用被跳过;返回的每项是 { role, content } 轮次,可直接拼入提示词。
  resolve(fewShotRefs, characterId) {
    const refs = fewShotRefs || [];
    const turns = [];
    for (const ref of refs) {
      const composed = this._resolveOne(ref, characterId);
      for (const turn of composed) {
        turns.push(turn);
      }
    }
    return turns;
  }
  //// /解析一组引用,按角色注入语气,产出展平的样例轮次 ////

  //// 解析单条引用:场景台词引用渲染成示例轮次,否则按结构加语气合成 [@busybee 2026-06-13] ////
  _resolveOne(ref, characterId) {
    // 场景台词引用:取本角色的场景台词样例,渲染成携带成品台词的示例轮次。
    if (ref && ref.sceneSet) {
      const sceneSet = this._bank.resolveSceneSet(ref.sceneSet, characterId);
      return this._bank.composeSceneTurns(sceneSet, ref.options || {});
    }
    const structureName = typeof ref === 'string' ? ref : ref && ref.structure;
    if (!structureName) {
      return [];
    }
    const structure = this._bank.resolveStructure(structureName);
    if (!structure) {
      return [];
    }
    // 语气名缺省回退到与结构同名,使意图只引结构也能取到本角色的对应语气。
    const toneName = (ref && ref.tone) || structureName;
    const tone = this._bank.resolveTone(toneName, characterId);
    const slots = (ref && ref.slots) || {};
    return this._bank.compose(structure, tone, slots);
  }
}

module.exports = { FewShotResolver };
