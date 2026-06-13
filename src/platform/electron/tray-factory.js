// audience: internal
// # tray-factory
// 把 Tray 与 Menu 的构建包成自有托盘接口,业务侧只见此接口。
// 不变量:electron 的 Tray 与 Menu 类型不越过本文件。

//// 用注入的 Tray 与 Menu 类建托盘,返回只暴露自有方法的托盘句柄 [@busybee 2026-06-13] ////
function createTray(spec) {
    const { Tray, Menu, iconPath, tooltip, onClick } = spec;
    if (typeof Tray !== 'function') {
        throw new Error('createTray 需要在 spec.Tray 注入 Tray 类');
    }
    if (!Menu || typeof Menu.buildFromTemplate !== 'function') {
        throw new Error('createTray 需要在 spec.Menu 注入 Menu 类');
    }

    const tray = new Tray(iconPath);
    if (tooltip) tray.setToolTip(tooltip);
    if (typeof onClick === 'function') tray.on('click', onClick);

    const handle = {
        // template 用平直数组描述菜单项,内部经 Menu.buildFromTemplate 转成第三方菜单
        setMenu(template) { tray.setContextMenu(Menu.buildFromTemplate(template)); },
        setToolTip(text) { tray.setToolTip(text); },
        destroy() { tray.destroy(); }
    };
    return handle;
}
//// /用注入的 Tray 与 Menu 类建托盘,返回只暴露自有方法的托盘句柄 ////

module.exports = { createTray };
