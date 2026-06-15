// audience: internal
// # screen-source
// 把 desktopCapturer、powerMonitor、screen 包成自有屏幕与空闲查询接口。
// 不变量:electron 的 desktopCapturer、powerMonitor、screen 类型不越过本文件。

//// 取得本文件所需的三个 electron 子系统,优先用注入,缺省时才向 electron 取 [@x380kkm 2026-06-13] ////
function resolveDeps(deps) {
    if (deps && deps.desktopCapturer && deps.powerMonitor && deps.screen) return deps;
    const electron = require('electron');
    return {
        desktopCapturer: (deps && deps.desktopCapturer) || electron.desktopCapturer,
        powerMonitor: (deps && deps.powerMonitor) || electron.powerMonitor,
        screen: (deps && deps.screen) || electron.screen
    };
}
//// /取得本文件所需的三个 electron 子系统,优先用注入,缺省时才向 electron 取 ////

//// 释放源数组里的原生图像引用,尽早回收 GPU 与进程内存 [@x380kkm 2026-06-13] ////
function releaseSources(sources) {
    if (!sources) return;
    for (const s of sources) {
        try { s.thumbnail = null; s.appIcon = null; } catch {}
    }
}
//// /释放源数组里的原生图像引用,尽早回收 GPU 与进程内存 ////

//// 截取指定窗口或主屏,产出 base64 的 JPEG,封掉 desktopCapturer 与原生图像类型 [@x380kkm 2026-06-13] ////
async function captureScreen(options) {
    const opts = options || {};
    const { desktopCapturer } = resolveDeps(opts.deps);
    // 缩略图边长,默认 512;质量为 JPEG 压缩级,默认 30
    const thumbnailSize = opts.thumbnailSize || { width: 512, height: 512 };
    const quality = opts.quality != null ? opts.quality : 30;
    const targetTitle = opts.targetTitle;

    let winSources = null, screenSources = null;
    try {
        if (targetTitle) {
            winSources = await desktopCapturer.getSources({ types: ['window'], thumbnailSize });
            const match = winSources.find(s => s.name === targetTitle);
            if (match) {
                const result = match.thumbnail.toJPEG(quality).toString('base64');
                releaseSources(winSources);
                return result;
            }
            releaseSources(winSources);
            winSources = null;
        }
        screenSources = await desktopCapturer.getSources({ types: ['screen'], thumbnailSize });
        if (screenSources.length > 0) {
            const result = screenSources[0].thumbnail.toJPEG(quality).toString('base64');
            releaseSources(screenSources);
            return result;
        }
        releaseSources(screenSources);
        return null;
    } catch (error) {
        releaseSources(winSources);
        releaseSources(screenSources);
        return null;
    }
}
//// /截取指定窗口或主屏,产出 base64 的 JPEG,封掉 desktopCapturer 与原生图像类型 ////

//// 查系统空闲秒数,封掉 powerMonitor [@x380kkm 2026-06-13] ////
function idleTime(deps) {
    const { powerMonitor } = resolveDeps(deps);
    return powerMonitor.getSystemIdleTime();
}
//// /查系统空闲秒数,封掉 powerMonitor ////

//// 取主屏工作区尺寸,封掉 screen,产出平直的宽高数据 [@x380kkm 2026-06-13] ////
function screenLayout(deps) {
    const { screen } = resolveDeps(deps);
    const { width, height } = screen.getPrimaryDisplay().workAreaSize;
    return { width, height };
}
//// /取主屏工作区尺寸,封掉 screen,产出平直的宽高数据 ////

module.exports = { captureScreen, idleTime, screenLayout };
