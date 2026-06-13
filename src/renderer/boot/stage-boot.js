// audience: internal
// # stage-boot
// 角色舞台渲染进程的组合根:从 preload 暴露的窄接口取依赖,构造注入给 stage 与设置面板。
// 不变量:渲染侧只经此处装配,业务模块从不直接抓全局,只见构造注入的接口。

import { CharacterStage } from '../stage/character-stage.js';

// 尺寸档位:控件加减号在这几档间移动,组合根只持档位顺序,不散落在多处按钮回调里。
export const SIZE_PRESETS = [200, 300, 400, 500];

// 默认档位下标:200/300/400/500 里的 300,启动与回退都用它。
const DEFAULT_SIZE_INDEX = 1;

// 鼠标跟踪归一化半径:光标到窗口中心的像素差除以它再钳到 -1 到 1。
const TRACK_RADIUS_PX = 300;

// 鼠标跟踪刷新周期(毫秒):每隔这么久取一次光标与窗口位置传给渲染适配。
const TRACK_INTERVAL_MS = 50;

//// 把模型配置解析成「用哪种渲染适配加已定模型目录」的纯数据,不触 DOM [@busybee 2026-06-13] ////
// raw 为窄接口读到的 config.model;validation 为 live2d 路径校验结果,可空。
// 校验未过时降级为 none;校验给出 modelDir 时把它记进 resolvedModelDir 供加载用。
export function resolveModelPlan(raw, validation) {
  const model = raw || { type: 'none' };
  if (model.type !== 'live2d') {
    return { kind: model.type === 'image' ? 'image' : 'none', config: model, resolvedModelDir: null };
  }
  if (validation && validation.valid === false) {
    return { kind: 'none', config: { type: 'none' }, resolvedModelDir: null };
  }
  const resolvedModelDir = (validation && validation.modelDir) || model.folderPath || null;
  return { kind: 'live2d', config: model, resolvedModelDir };
}

//// 算尺寸档位邻接状态:能否变小变大与下一档尺寸,供控件与右键菜单共用 [@busybee 2026-06-13] ////
// index 为当前档位下标;返回的 size 为该档对应的边长,direction 为 -1 或 +1 时给出移动后的下标与尺寸。
export function resolveSizeStep(index, direction) {
  const clamped = clampIndex(index);
  const next = clampIndex(clamped + direction);
  return {
    index: next,
    size: SIZE_PRESETS[next],
    canShrink: next > 0,
    canGrow: next < SIZE_PRESETS.length - 1
  };
}

//// 把任意尺寸映射回最近的合法档位下标,菜单改尺寸后用它对齐控件 [@busybee 2026-06-13] ////
// 不在档位表里的尺寸回退到默认档,避免下标越界。
export function sizeIndexOf(size) {
  const found = SIZE_PRESETS.indexOf(size);
  return found < 0 ? DEFAULT_SIZE_INDEX : found;
}

//// 把光标与窗口边界换算成钳在 -1 到 1 的跟踪坐标,渲染适配据此偏转头部 [@busybee 2026-06-13] ////
// cursor 为屏幕坐标 {x,y},bounds 为窗口 {x,y,width,height};以窗口中心为原点按半径归一化。
export function trackVector(cursor, bounds) {
  const centerX = bounds.x + bounds.width / 2;
  const centerY = bounds.y + bounds.height / 2;
  return {
    x: clampUnit((cursor.x - centerX) / TRACK_RADIUS_PX),
    y: clampUnit((cursor.y - centerY) / TRACK_RADIUS_PX)
  };
}

//// 把一次指针抬起判定成点击、长按或拖拽,交互上报据此分类 [@busybee 2026-06-13] ////
// down 为按下时记录的 {x,y,time},up 为抬起时的 {x,y,time};阈值由 gesture 给出。
// 位移超阈即拖拽;否则按停留时长分点击与长按。
export function classifyGesture(down, up, gesture) {
  const elapsed = up.time - down.time;
  const movedX = Math.abs(up.x - down.x);
  const movedY = Math.abs(up.y - down.y);
  const moved = movedX > gesture.movePx || movedY > gesture.movePx;
  if (moved) {
    return { kind: 'drag', elapsed };
  }
  if (elapsed < gesture.clickMs) {
    return { kind: 'click', elapsed };
  }
  return { kind: 'touch', elapsed };
}

//// 把旧式 (group, index) 动作信号反查成配置里的语义动作名 [@busybee 2026-06-13] ////
// 旧 IPC 仍按底层 group 与 index 发动作,新接口只认语义名;在组合根把旧词汇翻成新名。
// 配置 motionEmotions 形如 [{name, group, index}];查不到返回空,调用方据此跳过。
export function actionNameForMotion(modelConfig, group, index) {
  const table = (modelConfig && modelConfig.motionEmotions) || [];
  const hit = table.find((m) => m.group === group && m.index === index);
  return hit ? hit.name : null;
}

//// 把下标钳到档位表的合法范围 [@busybee 2026-06-13] ////
function clampIndex(index) {
  if (index < 0) return 0;
  if (index > SIZE_PRESETS.length - 1) return SIZE_PRESETS.length - 1;
  return index;
}

//// 把值钳到 -1 到 1 [@busybee 2026-06-13] ////
function clampUnit(value) {
  if (value < -1) return -1;
  if (value > 1) return 1;
  return value;
}

//// 装配角色舞台:取窄接口与注入的渲染适配工厂,挂头部、控件、跟踪与事件订阅 [@busybee 2026-06-13] ////
// narrowApi 为 preload 暴露的窄接口(window.electronAPI);deps 注入可替换的协作者:
//   createRenderAdapter(plan)  按解析后的模型计划造 RenderAdapter,浏览器侧创建 PIXI 与 Cubism 后注入
//   stage                      角色表现层,缺省现造一个 CharacterStage
//   timers                     setInterval/clearInterval,便于测试替换
// 返回 { dispose } 供宿主页卸载时停跟踪、释放适配。
export async function bootStage(narrowApi, deps = {}) {
  const createRenderAdapter = deps.createRenderAdapter;
  const stage = deps.stage || new CharacterStage();
  const timers = deps.timers || { setInterval, clearInterval };

  const lifecycle = {
    adapter: null,
    modelConfig: null,
    sizeIndex: DEFAULT_SIZE_INDEX,
    trackTimerId: null
  };

  //// 按窄接口读配置、解析模型计划、造适配并挂上头部 [@busybee 2026-06-13] ////
  async function mountModel() {
    const config = await narrowApi.loadConfig();
    const raw = config && config.model;
    let validation = null;
    if (raw && raw.type === 'live2d' && narrowApi.validateModelPaths) {
      validation = await narrowApi.validateModelPaths();
    }
    const plan = resolveModelPlan(raw, validation);
    lifecycle.modelConfig = plan.config;
    lifecycle.adapter = await createRenderAdapter(plan);
    stage.mountHead(lifecycle.adapter);
    if (plan.kind === 'live2d') {
      startTracking();
    }
  }
  //// /按窄接口读配置、解析模型计划、造适配并挂上头部 ////

  //// 定时取光标与窗口边界,算成跟踪坐标传给渲染适配 [@busybee 2026-06-13] ////
  function startTracking() {
    stopTracking();
    lifecycle.trackTimerId = timers.setInterval(async () => {
      const adapter = lifecycle.adapter;
      if (!adapter || typeof adapter.setTrack !== 'function') return;
      const cursor = await narrowApi.getCursorPosition();
      const bounds = await narrowApi.getWindowBounds();
      const v = trackVector(cursor, bounds);
      adapter.setTrack(v.x, v.y);
    }, TRACK_INTERVAL_MS);
  }

  function stopTracking() {
    if (lifecycle.trackTimerId !== null) {
      timers.clearInterval(lifecycle.trackTimerId);
      lifecycle.trackTimerId = null;
    }
  }
  //// /定时取光标与窗口边界 ////

  //// 把领域信号订阅到表现层:表情、动作、说话、配置热重载 [@busybee 2026-06-13] ////
  function subscribeSignals() {
    if (narrowApi.onPlayExpression) {
      narrowApi.onPlayExpression((name) => withAdapter((a) => a.playAction(name)));
    }
    if (narrowApi.onRevertExpression) {
      narrowApi.onRevertExpression(() => withAdapter((a) => a.revertAction()));
    }
    if (narrowApi.onPlayMotion) {
      narrowApi.onPlayMotion((group, index) => withAdapter((a) => {
        const name = actionNameForMotion(lifecycle.modelConfig, group, index);
        if (name) a.playAction(name);
      }));
    }
    if (narrowApi.onTalkingStateChanged) {
      narrowApi.onTalkingStateChanged((isTalking) => withAdapter((a) => {
        if (typeof a.setTalking === 'function') a.setTalking(isTalking);
      }));
    }
    if (narrowApi.onModelConfigUpdate) {
      narrowApi.onModelConfigUpdate(async () => {
        await remountModel();
      });
    }
  }
  //// /把领域信号订阅到表现层 ////

  //// 配置热重载:停跟踪、释放旧适配、按新配置重挂 [@busybee 2026-06-13] ////
  async function remountModel() {
    stopTracking();
    withAdapter((a) => a.dispose());
    lifecycle.adapter = null;
    await mountModel();
  }
  //// /配置热重载 ////

  //// 控件:加减改尺寸、设置、关闭,经窄接口下达,菜单改尺寸时回写档位 [@busybee 2026-06-13] ////
  const controls = {
    shrink() { stepSize(-1); },
    grow() { stepSize(1); },
    openSettings() { if (narrowApi.showSettings) narrowApi.showSettings(); },
    close() { if (narrowApi.closePetWindow) narrowApi.closePetWindow(); },
    syncSizeFromMenu(size) { lifecycle.sizeIndex = sizeIndexOf(size); }
  };

  function stepSize(direction) {
    const step = resolveSizeStep(lifecycle.sizeIndex, direction);
    if (step.index === lifecycle.sizeIndex) return;
    lifecycle.sizeIndex = step.index;
    if (narrowApi.setWindowSize) narrowApi.setWindowSize(step.size, step.size);
  }
  //// /控件 ////

  //// 对当前适配执行一个动作,无适配时静默跳过 [@busybee 2026-06-13] ////
  function withAdapter(action) {
    if (lifecycle.adapter) action(lifecycle.adapter);
  }

  if (narrowApi.onSizeChanged) {
    narrowApi.onSizeChanged((size) => controls.syncSizeFromMenu(size));
  }
  subscribeSignals();
  await mountModel();

  return {
    controls,
    stage,
    getAdapter: () => lifecycle.adapter,
    dispose() {
      stopTracking();
      withAdapter((a) => a.dispose());
      lifecycle.adapter = null;
    }
  };
}
//// /装配角色舞台 ////
