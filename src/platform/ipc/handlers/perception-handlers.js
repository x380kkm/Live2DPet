// audience: internal
// # perception-handlers
// 把屏幕感知通道(截屏、活动窗口、开窗列表、空闲秒数、主屏尺寸)注册到 ipc-router。
// 不变量:截屏与列窗口为隐私重能力,每次调用都先经 capability-gateway 门控再委托执行;
// 本文件不写裸通道字符串,通道名只来自 channel-registry;active-win 第三方类型经注入不在此 require。
//
// 依赖经构造注入:router 为 ipc-router,gateway 为 capability-gateway,screenSource 为屏幕源,
// activeWindow 为活动窗口查询器(封 active-win),scope 为门控作用域标识。

//// 截屏两档的缩略尺寸与 JPEG 质量:标清 512/30,高清 768/40 [@busybee 2026-06-13] ////
const CAPTURE_DEFAULT = { thumbnailSize: { width: 512, height: 512 }, quality: 30 };
const CAPTURE_HQ = { thumbnailSize: { width: 768, height: 768 }, quality: 40 };
//// /截屏两档的缩略尺寸与 JPEG 质量 ////

//// 在入口装配协作者并把屏幕感知通道注册到 ipc-router [@busybee 2026-06-13] ////
// gateway.invoke 负责重能力的逐次确认与执行委托;无害的空闲秒数与主屏尺寸不过网关。
function registerPerceptionHandlers(deps) {
  const { router, gateway, screenSource } = deps;
  const scope = deps.scope || 'perception';

  router.register('get-screen-capture', (targetTitle) =>
    gateway.invoke('get-screen-capture', scope, { targetTitle, profile: CAPTURE_DEFAULT }));

  router.register('get-screen-capture-hq', (targetTitle) =>
    gateway.invoke('get-screen-capture-hq', scope, { targetTitle, profile: CAPTURE_HQ }));

  router.register('get-active-window', () =>
    gateway.invoke('get-active-window', scope, null));

  router.register('get-open-windows', () =>
    gateway.invoke('get-open-windows', scope, null));

  router.register('get-system-idle-time', () => screenSource.idleTime());
}
//// /在入口装配协作者并把屏幕感知通道注册到 ipc-router ////

//// 造一个把能力 id 派发到屏幕源与活动窗口查询的执行器,交网关在门控通过后调用 [@busybee 2026-06-13] ////
// 网关只管门控,真正的采集落在这里;一处 switch 收敛 capabilityId 到具体采集动作。
function makePerceptionExecutor(deps) {
  const { screenSource, activeWindow } = deps;
  return async function execute(capabilityId, payload) {
    switch (capabilityId) {
      case 'get-screen-capture':
      case 'get-screen-capture-hq': {
        const profile = (payload && payload.profile) || CAPTURE_DEFAULT;
        return screenSource.captureScreen({
          targetTitle: payload && payload.targetTitle,
          thumbnailSize: profile.thumbnailSize,
          quality: profile.quality
        });
      }
      case 'get-active-window':
        return activeWindow.current();
      case 'get-open-windows':
        return activeWindow.openWindows();
      default:
        return { success: false, error: `未支持的感知能力:${capabilityId}` };
    }
  };
}
//// /造一个把能力 id 派发到屏幕源与活动窗口查询的执行器 ////

module.exports = { registerPerceptionHandlers, makePerceptionExecutor };
