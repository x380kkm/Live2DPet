// audience: internal
// # emotion-selector
// 到阈值后经有界 LLM 选情绪,产出语义动作名交渲染层。
// 不变量:本调用是事件驱动的有界调用,不每帧调;产物是语义动作名,不直接写渲染参数。
//
// 依赖经构造注入:bus 为事件总线,llm 为 LLM 客户端,config 给定可选情绪名与系统提示模板。
// select 接收 { spokenText, enabledNames? } 状态,挑出一个语义动作名,
// 经 bus 发布 { type:'EmotionSelected', name };选不出时发空名,渲染层自行回退。

const { StepId } = require('../../shared/step-catalog');

// 选定情绪后对外发布的事件类型。
const EMOTION_SELECTED = 'EmotionSelected';

class EmotionSelector {
  //// 构造注入事件总线、LLM 客户端与选情绪所需配置 [@x380kkm 2026-06-13] ////
  // config.enabledNames 为可选语义动作名;config.promptTemplate 为含 {0} 槽的系统提示。
  constructor(bus, llm, config) {
    this.bus = bus;
    this.llm = llm;
    this.enabledNames = (config && config.enabledNames) || [];
    this.promptTemplate = (config && config.promptTemplate) || '';

    // 调用进行中标志:避免一次事件触发多次并发选取。
    this.isSelecting = false;
  }

  //// 经有界 LLM 从可选名里挑一个语义动作名,发布选定事件 [@x380kkm 2026-06-13] ////
  // state.spokenText 为角色刚说的话;state.enabledNames 若给定则覆盖构造时的可选名。
  async select(state) {
    const names = (state && state.enabledNames) || this.enabledNames;
    if (this.isSelecting || names.length === 0) {
      return null;
    }

    this.isSelecting = true;
    try {
      const picked = await this._ask(names, (state && state.spokenText) || '');
      const matched = this._match(names, picked);
      this._publishSelected(matched);
      return matched;
    } catch (error) {
      // 选取失败发空名,渲染层据此自行随机回退,不让一次失败中断后续积累。
      this._publishSelected('');
      return '';
    } finally {
      this.isSelecting = false;
    }
  }
  //// /经有界 LLM 从可选名里挑一个语义动作名 ////

  //// 组装提示并发起一次非流式补全,返回模型选出的原始文本 [@x380kkm 2026-06-13] ////
  async _ask(names, spokenText) {
    const messages = [
      { role: 'system', content: this.promptTemplate.replace('{0}', names.join(', ')) },
      { role: 'user', content: `Character said: "${spokenText}"\nWhich emotion?` }
    ];
    // 情绪选择步:交模型路由按 emotionSelect 步配置(默认温度 0)
    const result = await this.llm.complete({ messages, step: StepId.EmotionSelect });
    return (result && result.text ? result.text : '').trim();
  }

  //// 把模型原始文本对齐到可选名:先精确命中,再按包含模糊命中 [@x380kkm 2026-06-13] ////
  _match(names, picked) {
    if (names.includes(picked)) {
      return picked;
    }
    const fuzzy = names.find((name) => picked && picked.includes(name));
    return fuzzy || '';
  }

  //// 向总线发布选定的语义动作名,空名表示交由渲染层回退 [@x380kkm 2026-06-13] ////
  _publishSelected(name) {
    this.bus.publish({ type: EMOTION_SELECTED, name });
  }
}

module.exports = { EmotionSelector, EMOTION_SELECTED };
