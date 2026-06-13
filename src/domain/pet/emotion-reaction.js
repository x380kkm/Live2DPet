// audience: internal
// # emotion-reaction
// 情绪连接件:订阅发言产物事件,把刚说出的话喂给情绪选择器,触发一次有界的情绪选取。
// 不变量:连接件只搭线不含选取逻辑;选取的并发抑制与失败回退都在 emotion-selector 内,本文件不重复。
//
// 依赖经构造注入:eventBus 经 subscribe 订阅事件;emotionSelector 经 select({ spokenText }) 选情绪。
// 订阅的发言产物事件有两种载荷:utterance-session 发 { utterance },pet 编排器发 { text };
// 两种都取出 spokenText 喂选择器。start 建立订阅并返回取消订阅的函数,stop 撤销订阅。

// 订阅的发言产物事件类型,与 utterance-session 及 pet 编排器发布的一致。
const UTTERANCE_PRODUCED = 'UtteranceProduced';

class EmotionReaction {
  //// 构造注入事件总线与情绪选择器 [@busybee 2026-06-13] ////
  constructor(deps = {}) {
    this.eventBus = deps.eventBus;
    this.emotionSelector = deps.emotionSelector;
    // 取消订阅的函数,start 时赋值、stop 时调用并清空。
    this._unsubscribe = null;
  }
  //// /构造注入事件总线与情绪选择器 ////

  //// 订阅发言产物事件,每条发言触发一次情绪选取 [@busybee 2026-06-13] ////
  // 返回取消订阅的函数;重复 start 先撤销上一次订阅,避免一条事件触发多次选取。
  start() {
    this.stop();
    this._unsubscribe = this.eventBus.subscribe(UTTERANCE_PRODUCED, (event) => {
      const spokenText = spokenTextOf(event);
      if (!spokenText) {
        return;
      }
      // select 自身做并发抑制与失败回退,连接件不等待其结果、不捕获其异常。
      this.emotionSelector.select({ spokenText });
    });
    return this._unsubscribe;
  }
  //// /订阅发言产物事件 ////

  //// 撤销订阅,使连接件不再触发情绪选取 [@busybee 2026-06-13] ////
  stop() {
    if (this._unsubscribe) {
      this._unsubscribe();
      this._unsubscribe = null;
    }
  }
  //// /撤销订阅 ////
}

//// 从两种发言产物载荷里取出刚说出的话 [@busybee 2026-06-13] ////
// utterance-session 发 { utterance:{ text } };pet 编排器发 { text }。
function spokenTextOf(event) {
  if (!event) {
    return '';
  }
  if (event.utterance && event.utterance.text) {
    return event.utterance.text;
  }
  return event.text || '';
}
//// /从两种发言产物载荷里取出刚说出的话 ////

module.exports = { EmotionReaction, UTTERANCE_PRODUCED };
