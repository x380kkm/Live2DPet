// audience: internal
// # window-factory
// 把 BrowserWindow 的创建与存活判断包成自有 Window 句柄,业务侧只见此接口。
// 不变量:electron 的 BrowserWindow 类型不越过本文件,业务侧从不直接 new。

//// 把一个 BrowserWindow 实例裹成只暴露自有方法的 Window 句柄 [@x380kkm 2026-06-13] ////
function wrapWindow(browserWindow) {
    const handle = {
        loadFile(filePath) { return browserWindow.loadFile(filePath); },
        on(eventName, listener) { browserWindow.on(eventName, listener); return handle; },
        send(channel, payload) { browserWindow.webContents.send(channel, payload); },
        openDevTools() { browserWindow.webContents.openDevTools(); },
        show() { browserWindow.show(); },
        hide() { browserWindow.hide(); },
        focus() { browserWindow.focus(); },
        close() { browserWindow.close(); },
        showInactive() { browserWindow.showInactive(); },
        isVisible() { return browserWindow.isVisible(); },
        setSize(width, height) { browserWindow.setSize(width, height); },
        setPosition(x, y) { browserWindow.setPosition(x, y); },
        getPosition() {
            const [x, y] = browserWindow.getPosition();
            return { x, y };
        },
        setBounds(bounds) { browserWindow.setBounds(bounds); },
        getBounds() { return browserWindow.getBounds(); },
        setAlwaysOnTop(flag, level) { browserWindow.setAlwaysOnTop(flag, level); },
        setVisibleOnAllWorkspaces(flag, opts) { browserWindow.setVisibleOnAllWorkspaces(flag, opts); },
        applyResponseHeader(name, values) {
            browserWindow.webContents.session.webRequest.onHeadersReceived((details, callback) => {
                callback({
                    responseHeaders: { ...details.responseHeaders, [name]: values }
                });
            });
        },
        // 仅适配层内部据此判断存活,业务侧改用 isAlive
        _raw: browserWindow
    };
    return handle;
}
//// /把一个 BrowserWindow 实例裹成只暴露自有方法的 Window 句柄 ////

//// 用注入的 BrowserWindow 类建窗,返回自有句柄,第三方类型止于本文件 [@x380kkm 2026-06-13] ////
function createWindow(options) {
    const { BrowserWindow, ...windowOptions } = options;
    if (typeof BrowserWindow !== 'function') {
        throw new Error('createWindow 需要在 options.BrowserWindow 注入 BrowserWindow 类');
    }
    return wrapWindow(new BrowserWindow(windowOptions));
}
//// /用注入的 BrowserWindow 类建窗,返回自有句柄,第三方类型止于本文件 ////

//// 判断窗口句柄是否仍存活,封掉 isDestroyed 这一第三方判断 [@x380kkm 2026-06-13] ////
function isAlive(handle) {
    if (!handle || !handle._raw) return false;
    return !handle._raw.isDestroyed();
}
//// /判断窗口句柄是否仍存活,封掉 isDestroyed 这一第三方判断 ////

module.exports = { createWindow, isAlive };
