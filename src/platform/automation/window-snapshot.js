// audience: internal
// # window-snapshot
// 窗口快照:把一组命名窗口句柄折成纯数据快照(名称、是否存活可见、边界),第三方 BrowserWindow 止于此。
// 不变量:不改窗口状态;句柄已死或缺失时该窗标记为不存活;边界取不到时回 null。

//// 把命名窗口句柄折成纯数据快照数组 [@x380kkm 2026-06-14] ////
// named 为 { name: windowHandle } 映射;isAlive(win) 判句柄是否仍存活,缺省按真值判。
function snapshotWindows(named, isAlive) {
  const alive = typeof isAlive === 'function' ? isAlive : (win) => Boolean(win);
  const map = named || {};
  return Object.keys(map).map((name) => {
    const win = map[name];
    const live = alive(win);
    return {
      name,
      alive: live,
      visible: live && typeof win.isVisible === 'function' ? win.isVisible() : false,
      bounds: live && typeof win.getBounds === 'function' ? win.getBounds() : null
    };
  });
}
//// /把命名窗口句柄折成纯数据快照数组 ////

module.exports = { snapshotWindows };
