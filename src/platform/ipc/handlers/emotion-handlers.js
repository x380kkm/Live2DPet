// audience: internal
// # emotion-handlers
// 把情绪与发言相关通道注册到 ipc-router,并经事件总线把这些信号转发到目标窗口。
// 不变量:转发改为经 event-bus 发布、订阅,不再点对点 webContents.send;
// 通道名只来自 channel-registry;窗口句柄不进领域侧,死窗口由总线侧统一过滤后剔除。
//
// 迁移自 src/main/emotion-ipc.js:原先各通道收到调用即直接 ctx.petWindow.webContents.send。
// 现在通道处理器只把信号发布成领域事件;一处订阅把事件转发到目标窗口,发布方与窗口解耦。
//
// 依赖经构造注入:router 为 ipc-router,bus 为 event-bus,
// petWindow、settingsWindow 为取目标窗口的取值函数(返回当前窗口或 null)。

//// 内部领域事件类型:通道处理器发布这些,窗口订阅者据类型转发到对应窗口 [@busybee 2026-06-13] ////
const EVENTS = {
  playExpression: 'PlayExpression',
  revertExpression: 'RevertExpression',
  playMotion: 'PlayMotion',
  talkingStateChanged: 'TalkingStateChanged',
  petHoverState: 'PetHoverState',
  petHit: 'PetHit'
};
//// /内部领域事件类型 ////

//// 领域事件类型到渲染侧推送通道名的映射,转发时据此选 send 的通道 [@busybee 2026-06-13] ////
const RENDER_CHANNEL = {
  [EVENTS.playExpression]: 'play-expression',
  [EVENTS.revertExpression]: 'revert-expression',
  [EVENTS.playMotion]: 'play-motion',
  [EVENTS.talkingStateChanged]: 'talking-state-changed',
  [EVENTS.petHoverState]: 'pet-hover-state',
  [EVENTS.petHit]: 'pet-hit'
};
//// /领域事件类型到渲染侧推送通道名的映射 ////

//// 据事件类型决定它该转发到宠物窗口还是设置窗口 [@busybee 2026-06-13] ////
// 表情与动作面向宠物窗口;悬停与命中是回报给设置窗口的交互信号。
const TARGET = {
  [EVENTS.playExpression]: 'pet',
  [EVENTS.revertExpression]: 'pet',
  [EVENTS.playMotion]: 'pet',
  [EVENTS.talkingStateChanged]: 'pet',
  [EVENTS.petHoverState]: 'settings',
  [EVENTS.petHit]: 'settings'
};
//// /据事件类型决定它该转发到哪个窗口 ////

//// 装配协作者:注册情绪通道处理器,并订阅总线把事件转发到目标窗口 [@busybee 2026-06-13] ////
function registerEmotionHandlers(deps) {
  const { router, bus } = deps;
  const getWindow = { pet: deps.petWindow, settings: deps.settingsWindow };

  registerForwardingChannels(router, bus);
  subscribeForwarders(bus, router, getWindow);
}
//// /装配协作者 ////

//// 把六个情绪通道收成「调用即发布对应领域事件」的处理器 [@busybee 2026-06-13] ////
// 处理器不碰窗口,只把入参折成事件交总线;调用方拿到成功回执即可。
function registerForwardingChannels(router, bus) {
  router.register('trigger-expression', (expressionName) => {
    bus.publish({ type: EVENTS.playExpression, args: [expressionName] });
    return { success: true };
  });

  router.register('revert-expression', () => {
    bus.publish({ type: EVENTS.revertExpression, args: [] });
    return { success: true };
  });

  router.register('trigger-motion', (payload) => {
    const { group, index } = payload || {};
    bus.publish({ type: EVENTS.playMotion, args: [group, index] });
    return { success: true };
  });

  router.register('set-talking-state', (isTalking) => {
    bus.publish({ type: EVENTS.talkingStateChanged, args: [isTalking] });
    return { success: true };
  });

  router.register('report-hover-state', (isHovering) => {
    bus.publish({ type: EVENTS.petHoverState, args: [isHovering] });
    return { success: true };
  });

  router.register('report-hit', (data) => {
    bus.publish({ type: EVENTS.petHit, args: [data] });
    return { success: true };
  });
}
//// /把六个情绪通道收成发布处理器 ////

//// 为每类事件订阅一条转发:取目标窗口,存活则推送到对应渲染通道 [@busybee 2026-06-13] ////
// 订阅时传入存活判断,死窗口由总线在分发时统一过滤并剔除该订阅。
function subscribeForwarders(bus, router, getWindow) {
  for (const type of Object.keys(RENDER_CHANNEL)) {
    const which = TARGET[type];
    const channel = RENDER_CHANNEL[type];
    bus.subscribe(
      type,
      (event) => {
        const target = getWindow[which]();
        target.webContents.send(channel, ...(event.args || []));
      },
      () => router.isAlive(getWindow[which]())
    );
  }
}
//// /为每类事件订阅一条转发 ////

module.exports = { registerEmotionHandlers, EVENTS };
