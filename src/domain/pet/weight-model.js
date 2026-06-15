// audience: internal
// # weight-model
// 动作权重模型:从静态基值与情绪当前值算出各候选动作的有效权重,渲染成一句占比描述,并用低差异序列抽一个建议动作。
// 不变量:纯逻辑无副作用;占比描述与建议只供意图选择这一层,不进主 LLM 的人格上下文;情绪只抬升模组倾向、不压对话到零。
//
// 静态基值来自用户设置:对话总权重与模组总权重的比例(默认 800 比 200)在各对话候选与各模组候选间平分,
// 也可按意图 id 逐条覆盖。情绪当前值(归一到 [0,1])按比例抬升模组候选的权重,实现「情绪越高越倾向做模组」。

const { pickByWeight } = require('./low-discrepancy');

//// 判断一个意图是不是模组动作:来源不是出厂或角色,即来自某个模组 [@x380kkm 2026-06-14] ////
function isModAction(intent) {
  const origin = intent && intent.origin;
  if (!origin || origin === 'builtin') {
    return false;
  }
  return !String(origin).startsWith('character');
}
//// /判断一个意图是不是模组动作 ////

//// 把数值夹到 [0,1],非数按 0 计 [@x380kkm 2026-06-14] ////
function clamp01(value) {
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    return 0;
  }
  return Math.min(1, Math.max(0, value));
}
//// /把数值夹到 [0,1] ////

class WeightModel {
  //// 构造注入静态基值、逐意图覆盖与情绪抬升系数 [@x380kkm 2026-06-14] ////
  // config.dialogueBase / config.modBase:对话总权重与模组总权重,在同类候选间平分。
  // config.perIntent:按意图 id 覆盖该意图的权重,优先于平分值。
  // config.emotionModLift:满情绪(emotion=1)时模组权重相对抬升的比例,默认半成。
  constructor(config = {}) {
    this.dialogueBase = config.dialogueBase != null ? config.dialogueBase : 800;
    this.modBase = config.modBase != null ? config.modBase : 200;
    this.perIntent = config.perIntent || {};
    this.emotionModLift = config.emotionModLift != null ? config.emotionModLift : 0.5;
  }
  //// /构造注入静态基值、逐意图覆盖与情绪抬升系数 ////

  //// 算一个候选的静态基值:有逐意图覆盖取覆盖,否则按同类候选数平分总权重 [@x380kkm 2026-06-14] ////
  baseWeight(intent, dialogueCount, modCount) {
    if (this.perIntent[intent.id] != null) {
      return this.perIntent[intent.id];
    }
    if (isModAction(intent)) {
      return this.modBase / Math.max(1, modCount);
    }
    return this.dialogueBase / Math.max(1, dialogueCount);
  }
  //// /算一个候选的静态基值 ////

  //// 算各候选的有效权重:静态基值再按情绪抬升模组项 [@x380kkm 2026-06-14] ////
  // emotion 为归一到 [0,1] 的情绪当前值;返回 [{ id, weight, isMod }],顺序同 candidates。
  effectiveWeights(candidates, emotion = 0) {
    const e = clamp01(emotion);
    const list = candidates || [];
    const modCount = list.filter(isModAction).length;
    const dialogueCount = list.length - modCount;
    return list.map((intent) => {
      const mod = isModAction(intent);
      let weight = this.baseWeight(intent, dialogueCount, modCount);
      if (mod) {
        weight *= 1 + this.emotionModLift * e;
      }
      return { id: intent.id, weight, isMod: mod };
    });
  }
  //// /算各候选的有效权重 ////

  //// 把候选与情绪折成一份选择简报:占比描述加一个低差异建议动作 [@x380kkm 2026-06-14] ////
  // sampler 为低差异序列实例,调一次 next 推进;无候选返回空描述与空建议。
  brief(candidates, emotion = 0, sampler = null) {
    const eff = this.effectiveWeights(candidates, emotion);
    if (eff.length === 0) {
      return { description: '', suggestedId: null, effective: eff };
    }
    const total = eff.reduce((sum, item) => sum + item.weight, 0) || 1;
    const parts = eff.map((item) => `${item.id} 约 ${Math.round((item.weight / total) * 100)}%`);
    const description = `各动作的倾向占比:${parts.join('、')}。倾向高的优先,但可结合当前情境调整。`;

    let suggestedId = eff[0].id;
    if (sampler && typeof sampler.next === 'function') {
      const index = pickByWeight(eff.map((item) => item.weight), sampler.next());
      suggestedId = eff[index].id;
    }
    return { description, suggestedId, effective: eff };
  }
  //// /把候选与情绪折成一份选择简报 ////
}

module.exports = { WeightModel, isModAction };
