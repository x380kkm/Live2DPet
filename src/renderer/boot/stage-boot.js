// audience: internal
// # stage-boot
// 角色舞台渲染进程的组合根:从 preload 暴露的窄接口取依赖,构造注入给 stage 与设置面板。
// 不变量:渲染侧只经此处装配,业务模块从不直接抓全局,只见构造注入的接口。

import { CharacterStage } from '../stage/character-stage.js';
import { Live2dRenderer } from '../../platform/render/live2d-renderer.js';
import { ImageRenderer } from '../../platform/render/image-renderer.js';

// 尺寸档位:控件加减号在这几档间移动,组合根只持档位顺序,不散落在多处按钮回调里。
export const SIZE_PRESETS = [200, 300, 400, 500];

// 模型相对画布的竖直锚点比例:模型中心落在画布高度的这一比例处。
const MODEL_Y_RATIO = 0.6;

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

//// 按模型计划造真实渲染适配:live2d 起 PIXI 与 Cubism、image 接图片元素、none 给空适配 [@busybee 2026-06-13] ////
// env 注入浏览器侧全局便于测试替换:{ PIXI, Live2DModel, doc, fetchJson }。
//   PIXI         libs/pixi.min.js 暴露的全局 PIXI
//   Live2DModel  libs/cubism4.min.js 挂在 PIXI.live2d.Live2DModel 上的模型类
//   doc          document,用于取画布与图片元素
//   fetchJson    取 JSON 的函数,加载表情文件用,封住对 fetch 的依赖
// live2d 适配在此完成 PIXI 应用创建、模型加载、缩放贴合与每帧表情应用;Cubism 私有字段访问仍只在 live2d-renderer 内。
// 头部跟踪经 live2d-renderer 的 setTrack 偏转角度参数;无该方法的渲染器(图片、空)由 wrapTrackable 补成无害默认。
export async function createRenderAdapter(plan, env) {
  if (plan.kind === 'image') {
    return makeImageAdapter(plan, env);
  }
  if (plan.kind !== 'live2d') {
    return makeNullAdapter();
  }
  return makeLive2dAdapter(plan, env);
}
//// /按模型计划造真实渲染适配 ////

//// 造 live2d 适配:起 PIXI 应用、加载模型、贴合画布、加表情、挂每帧应用 [@busybee 2026-06-13] ////
async function makeLive2dAdapter(plan, env) {
  const { PIXI, Live2DModel, doc, fetchJson } = env;
  const canvas = doc.getElementById('live2d-canvas');

  if (Live2DModel && typeof Live2DModel.registerTicker === 'function') {
    Live2DModel.registerTicker(PIXI.Ticker);
  }

  const pixiApp = new PIXI.Application({
    view: canvas, transparent: true, autoStart: true,
    width: env.width || (doc.defaultView && doc.defaultView.innerWidth) || 300,
    height: env.height || (doc.defaultView && doc.defaultView.innerHeight) || 300,
    backgroundAlpha: 0, resolution: (doc.defaultView && doc.defaultView.devicePixelRatio) || 1,
    autoDensity: true, antialias: true
  });

  const modelPath = modelFileUrl(plan.resolvedModelDir, plan.config.modelJsonFile);
  const model = await Live2DModel.from(modelPath, { autoUpdate: true, autoInteract: false });
  model.anchor.set(0.5, 0.5);
  pixiApp.stage.addChild(model);
  fitModel(model, pixiApp);

  const renderer = new Live2dRenderer({ pixiApp, model, config: plan.config, fetchJson });
  await renderer.loadExpressions(plan.resolvedModelDir);

  // 每帧把当前激活表情写进模型,口型与表情的逐帧应用收在 live2d-renderer 内。
  pixiApp.ticker.add(() => renderer.applyExpression());

  return wrapTrackable(renderer);
}
//// /造 live2d 适配 ////

//// 造 image 适配:取页面图片元素,隐藏画布,接图片渲染器 [@busybee 2026-06-13] ////
function makeImageAdapter(plan, env) {
  const doc = env.doc;
  const canvas = doc.getElementById('live2d-canvas');
  if (canvas) canvas.style.display = 'none';
  const imageElement = doc.getElementById('static-image');
  if (imageElement) imageElement.style.display = 'block';
  const renderer = new ImageRenderer({ imageElement, config: plan.config });
  return wrapTrackable(renderer);
}
//// /造 image 适配 ////

//// 造空适配:无模型时只兑现接口,什么都不做 [@busybee 2026-06-13] ////
function makeNullAdapter() {
  return { playAction() {}, revertAction() {}, setTalking() {}, setTrack() {}, dispose() {} };
}
//// /造空适配 ////

//// 给渲染器补上 setTrack 与 setTalking,使其满足 stage-boot 调用的适配接口 [@busybee 2026-06-13] ////
// live2d 渲染器自带 setTrack(偏转头部角度)与无 setTalking;图片与空渲染器都无 setTrack。
// 已有则原样保留,缺则补成无害默认,使组合根对所有适配统一调用。
function wrapTrackable(renderer) {
  if (typeof renderer.setTrack !== 'function') {
    renderer.setTrack = () => {};
  }
  if (typeof renderer.setTalking !== 'function') {
    renderer.setTalking = () => {};
  }
  return renderer;
}
//// /给渲染器补上 setTrack 与 setTalking ////

//// 把模型目录与 model3.json 文件名拼成可加载的 file:// 地址 [@busybee 2026-06-13] ////
// 已是 file:// 或 http 的目录原样用;否则转成 file:/// 并把反斜杠换成正斜杠。
function modelFileUrl(modelDir, modelJsonFile) {
  let base = modelDir || '';
  if (!base.startsWith('file://') && !base.startsWith('http')) {
    base = 'file:///' + base.replace(/\\/g, '/');
  }
  return base + '/' + modelJsonFile;
}
//// /把模型目录与 model3.json 文件名拼成可加载的 file:// 地址 ////

//// 把模型按画布宽度等比缩放并锚到画布中下部 [@busybee 2026-06-13] ////
function fitModel(model, pixiApp) {
  const w = pixiApp.renderer.width;
  const h = pixiApp.renderer.height;
  const origW = model.width || w;
  model.scale.set(w / origW);
  model.x = w / 2;
  model.y = h * MODEL_Y_RATIO;
}
//// /把模型按画布宽度等比缩放并锚到画布中下部 ////

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
