// audience: internal
// # expression-arbiter
// 表达区仲裁:对话气泡与 mod 前端是同一表达区的两个占用者,同一时刻至多一个占主导。
// 不变量:某占用者占主导时,先前占主导的另一占用者被收起;收起动作经构造注入,本模块不持任何窗口句柄。
// 取代渲染侧 ExpressionArea 在多窗口下失效的就地仲裁:气泡与 mod 前端各为独立窗口,排他在主进程一处协调。

//// 造表达区仲裁:按占用者名记当前主导,换主导时调被替下者的收起钩子 [@busybee 2026-06-14] ////
// deps.hide 形如 { bubble: fn, mod: fn };某占用者被替下时调它对应的收起钩子,缺钩子则跳过。
function createExpressionArbiter(deps) {
  const hide = (deps && deps.hide) || {};
  let dominant = null;

  return {
    //// 让一个占用者占主导:收起先前主导者,返回被替下的占用者名,已是它则不动 [@busybee 2026-06-14] ////
    takeOver(occupant) {
      if (dominant === occupant) return null;
      const displaced = dominant;
      if (displaced && typeof hide[displaced] === 'function') hide[displaced]();
      dominant = occupant;
      return displaced;
    },
    //// 释放某占用者的主导:仅当它正占主导时回到无人占用 [@busybee 2026-06-14] ////
    release(occupant) {
      if (dominant === occupant) dominant = null;
    },
    //// 查当前占主导的占用者名,无人占用返回 null [@busybee 2026-06-14] ////
    current() {
      return dominant;
    }
  };
}
//// /造表达区仲裁 ////

module.exports = { createExpressionArbiter };
