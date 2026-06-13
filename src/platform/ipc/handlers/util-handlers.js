// audience: internal
// # util-handlers
// 把通用工具通道注册到 ipc-router:配置读写、应用信息、外发、增强数据持久化、渲染日志转发。
// 不变量:外发(open-external、web-search)与文件(增强数据读写)为重能力,逐次经 capability-gateway 门控;
// 通道名只来自 channel-registry;配置变更不再点对点 send,改为经 event-bus 发布;裸字符串不出库。
//
// 迁移自 src/main/utility-ipc.js 与 src/main/enhance-ipc.js:
// 原先各通道直接 ipcMain.handle,save-config 内部 ctx.petWindow.webContents.send 通知热重载,
// open-external 与 web-search 直接执行,增强数据直接 fs 读写。
// 现在配置变更经总线发布,外发与文件能力经网关门控,网络与落盘细节落在平台侧的源里。
//
// 依赖经构造注入:router 为 ipc-router,gateway 为 capability-gateway,bus 为 event-bus,
// configStore 给出配置读写,appInfo 给出应用路径,enhanceStore 给出增强数据读写,
// logSink 接收渲染侧日志,scope 为门控作用域标识。

//// 配置保存后对外发布的领域事件类型:订阅方据此热重载,替代点对点 send [@busybee 2026-06-13] ////
const CONFIG_SAVED = 'ConfigSaved';

//// 装配协作者并把工具通道注册到 ipc-router [@busybee 2026-06-13] ////
function registerUtilHandlers(deps) {
  const { router } = deps;
  registerConfigChannels(router, deps);
  registerSystemChannels(router, deps);
  registerOutboundChannels(router, deps);
  registerFileChannels(router, deps);
}
//// /装配协作者 ////

//// 配置读写:读直放,写落盘后把保存事件发上总线供订阅方热重载 [@busybee 2026-06-13] ////
function registerConfigChannels(router, deps) {
  const { configStore, bus } = deps;

  router.register('load-config', () => configStore.load());

  router.register('save-config', async (data) => {
    const result = await configStore.save(data);
    bus.publish({ type: CONFIG_SAVED, config: data });
    return result;
  });
}
//// /配置读写 ////

//// 系统信息与渲染日志:应用路径、性别称谓、渲染侧日志按级别落到日志槽 [@busybee 2026-06-13] ////
function registerSystemChannels(router, deps) {
  const { appInfo, logSink } = deps;

  router.register('get-app-path', () => appInfo.appPath());

  router.register('get-gender-term', () => ({ success: true, term: 'you' }));

  router.register('renderer-log', (payload) => {
    const { level, args } = payload || {};
    logSink.write(level, args || []);
    return { success: true };
  });
}
//// /系统信息与渲染日志 ////

//// 外发:打开外链与网络搜索均为外发重能力,经网关门控后委托执行 [@busybee 2026-06-13] ////
function registerOutboundChannels(router, deps) {
  const { gateway } = deps;
  const scope = deps.scope || 'util';

  router.register('open-external', (url) =>
    gateway.invoke('open-external', scope, { url }));

  router.register('web-search', (payload) =>
    gateway.invoke('web-search', scope, payload || {}));
}
//// /外发 ////

//// 文件:增强数据读写为文件重能力,经网关门控后委托执行 [@busybee 2026-06-13] ////
function registerFileChannels(router, deps) {
  const { gateway } = deps;
  const scope = deps.scope || 'util';

  router.register('save-enhance-data', (data) =>
    gateway.invoke('save-enhance-data', scope, { data }));

  router.register('load-enhance-data', () =>
    gateway.invoke('load-enhance-data', scope, null));
}
//// /文件 ////

//// 造一个把外发与文件能力 id 派发到具体源的执行器,交网关在门控通过后调用 [@busybee 2026-06-13] ////
// 一处 switch 收敛 capabilityId 到外链、搜索与增强数据读写。
function makeUtilExecutor(deps) {
  const { shell, searchSource, enhanceStore, isValidUrl } = deps;
  const validate = isValidUrl || (() => true);

  return async function execute(capabilityId, payload) {
    switch (capabilityId) {
      case 'open-external': {
        const url = payload && payload.url;
        if (!validate(url)) return { success: false, error: 'invalid URL' };
        await shell.openExternal(url);
        return { success: true };
      }
      case 'web-search':
        return searchSource.search(payload.query, payload.provider, payload.options);
      case 'save-enhance-data':
        return enhanceStore.save(payload.data);
      case 'load-enhance-data':
        return enhanceStore.load();
      default:
        return { success: false, error: `未支持的工具能力:${capabilityId}` };
    }
  };
}
//// /造一个把外发与文件能力 id 派发到具体源的执行器 ////

module.exports = { registerUtilHandlers, makeUtilExecutor, CONFIG_SAVED };
