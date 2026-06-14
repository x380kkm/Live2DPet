// audience: internal
// # utterance-session
// 发言会话:可被外部直接调用,用取消令牌表达取消。
// 不变量:取消经显式令牌而非全局静态计数器;会话不直接持有窗口句柄,产物经事件总线发布。
// 构造注入:eventBus(发布发言事件)、ttsOrchestrator(分句合成对齐)从外部传入,本文件不抓全局。

const { Utterance } = require('./utterance');

//// 表达一次发言取消状态的显式令牌 [@busybee 2026-06-13] ////
class CancelToken {
  constructor() {
    this.cancelled = false;
  }

  //// 标记为已取消 [@busybee 2026-06-13] ////
  cancel() {
    this.cancelled = true;
  }

  //// 是否仍在进行,即未被取消 [@busybee 2026-06-13] ////
  isActive() {
    return !this.cancelled;
  }
}

//// 协调一次发言的合成与对齐,产物经事件总线发布,取消经令牌 [@busybee 2026-06-13] ////
class UtteranceSession {
  constructor({ eventBus, ttsOrchestrator } = {}) {
    this.eventBus = eventBus;
    this.ttsOrchestrator = ttsOrchestrator;
    // 当前进行中发言的取消令牌,新发言开始时取消旧令牌
    this._activeToken = null;
  }

  //// 开始一次发言:取消上一条、合成对齐、发布产物,返回本次的取消令牌 [@busybee 2026-06-13] ////
  // request 为 { text, emotion } 形态的发言请求。
  start(request) {
    if (this._activeToken) this._activeToken.cancel();
    const token = new CancelToken();
    this._activeToken = token;

    const utterance = Utterance.of(request.text, request.emotion);
    if (this.ttsOrchestrator) this.ttsOrchestrator.synthesize(utterance);

    // 合成期间可能已被新发言取消,取消则不发布产物
    if (token.isActive()) this._publish(utterance);
    return token;
  }

  //// 经令牌取消进行中的发言,若取消的是当前发言则发布发言结束事件 [@busybee 2026-06-13] ////
  cancel(token) {
    if (!token) return;
    token.cancel();
    if (token === this._activeToken) {
      this._activeToken = null;
      this._publishEnded();
    }
  }

  //// 把发言产物连同气泡时长与音频对齐经事件总线发布 [@busybee 2026-06-13] ////
  _publish(utterance) {
    if (!this.eventBus) return;
    this.eventBus.publish({
      type: 'UtteranceProduced',
      utterance,
      bubbleDurationMs: utterance.bubbleDurationMs(),
      hasAudio: utterance.hasAudio(),
    });
  }
  //// /把发言产物经事件总线发布 ////

  //// 发布发言结束事件,供说话状态与气泡的订阅者收尾 [@busybee 2026-06-13] ////
  _publishEnded() {
    if (!this.eventBus) return;
    this.eventBus.publish({ type: 'UtteranceEnded' });
  }
}

module.exports = { UtteranceSession, CancelToken };
