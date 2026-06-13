// audience: internal
// # fewshot-resolver
// few-shot 解析器:解析意图的 few-shot 引用,经模板变量插槽受控注入语气。
// 不变量:语气只在插槽处注入,结构样例与成品句子不混写,守住与角色文风的隔离。
//
// 引用是纯数据:{ structure, tone?, slots? }。意图只引结构名,语气名缺省即取与结构同名的语气样例。
// 解析流程:先取全局结构骨架,再取本角色语气样例,然后经 bank.compose 在插槽处注入语气,产出样例轮次。
// 语气在跨角色之间互不可见,某角色缺该语气样例时只留空骨架,绝不借用别的角色的文风。

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

  //// 解析单条引用:取结构骨架与本角色语气,经插槽注入合成 [@busybee 2026-06-13] ////
  _resolveOne(ref, characterId) {
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
