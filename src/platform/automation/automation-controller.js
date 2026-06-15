// audience: internal
// # automation-controller
// 自动化操纵控制器:把一条命令映射成对注入能力的一次调用,回一份结果或错误。纯逻辑,不持流不持窗口。
// 不变量:命令与结果都是纯数据;未知操作回错误不抛;每个操作的异常被收敛成 { ok:false, error }。
//
// 能力经构造注入,各为一个函数:
//   runTick()                  驱动调度器跑一拍,返回 Promise
//   injectInteraction({name})  往事件总线发一条交互事件
//   fetchRecentReplies(count)  取最近若干条发言文本
//   synthesize(text)           合成一段语音,返回 { hasAudio, bytes, error }
//   listWindows()              取当前窗口快照数组

class AutomationController {
  //// 构造注入一组能力函数 [@x380kkm 2026-06-14] ////
  constructor(caps = {}) {
    this.caps = caps;
  }

  //// 处理一条命令:派发到对应能力,异常收敛成错误结果 [@x380kkm 2026-06-14] ////
  // command 形如 { id, op, args };返回 { id, ok, result } 或 { id, ok:false, error }。
  async handle(command) {
    const id = command && command.id != null ? command.id : null;
    const op = command && command.op;
    try {
      const result = await this._dispatch(op, (command && command.args) || {});
      return { id, ok: true, result };
    } catch (error) {
      return { id, ok: false, error: error && error.message ? error.message : String(error) };
    }
  }
  //// /处理一条命令 ////

  //// 按操作名派发到对应能力 [@x380kkm 2026-06-14] ////
  async _dispatch(op, args) {
    switch (op) {
      case 'ping':
        return { pong: true };
      case 'schedule-tick':
        await this._cap('runTick')();
        return { ticked: true };
      case 'inject-interaction':
        this._cap('injectInteraction')({ name: args.name, payload: args.payload || null });
        return { injected: args.name };
      case 'fetch-recent-reply':
        return { replies: this._cap('fetchRecentReplies')(args.count || 1) };
      case 'trigger-tts': {
        const out = (await this._cap('synthesize')(args.text || '')) || {};
        return { hasAudio: !!out.hasAudio, bytes: out.bytes || 0, error: out.error };
      }
      case 'list-windows':
        return { windows: this._cap('listWindows')() };
      default:
        throw new Error(`未知操作:${op}`);
    }
  }
  //// /按操作名派发 ////

  //// 取一个已注入的能力函数,缺失即抛错 [@x380kkm 2026-06-14] ////
  _cap(name) {
    const fn = this.caps[name];
    if (typeof fn !== 'function') {
      throw new Error(`未注入能力:${name}`);
    }
    return fn;
  }
}

module.exports = { AutomationController };
