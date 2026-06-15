// audience: internal
// # active-window-source
// 把 active-win 包成自有的活动窗口与开窗列表查询接口,产出平直的成败数据。
// 不变量:第三方 active-win 类型不越过本文件;查询失败折成 { success:false, error } 而非抛出。
//
// 依赖经构造注入:loadActiveWin 异步给出 active-win 模块,缺省时才动态 import 真实包。
// active-win 仅发布为 ESM,主进程侧用动态 import 取得,故查询为异步。

//// 取得 active-win 模块,优先用注入,缺省时才动态 import [@x380kkm 2026-06-13] ////
function makeLoader(injected) {
  if (injected) return injected;
  return () => import('active-win');
}
//// /取得 active-win 模块,优先用注入,缺省时才动态 import ////

//// 装配 active-win 加载器,产出活动窗口与开窗列表两个查询 [@x380kkm 2026-06-13] ////
function createActiveWindowSource(deps = {}) {
  const load = makeLoader(deps.loadActiveWin);

  //// 查当前活动窗口,无活动窗口或出错都折成失败数据 [@x380kkm 2026-06-13] ////
  async function current() {
    try {
      const mod = await load();
      const activeWin = mod.default || mod;
      const result = await activeWin();
      if (result) return { success: true, data: result };
      return { success: false, error: 'no active window' };
    } catch (error) {
      return { success: false, error: error.message };
    }
  }
  //// /查当前活动窗口 ////

  //// 列出全部打开的窗口,出错折成失败数据 [@x380kkm 2026-06-13] ////
  async function openWindows() {
    try {
      const mod = await load();
      const windows = await mod.getOpenWindows();
      return { success: true, data: windows || [] };
    } catch (error) {
      return { success: false, error: error.message };
    }
  }
  //// /列出全部打开的窗口 ////

  return { current, openWindows };
}
//// /装配 active-win 加载器 ////

module.exports = { createActiveWindowSource };
