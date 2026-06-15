// audience: internal
// # stage-boot
// 角色舞台渲染进程的组合根:从 preload 暴露的窄接口取依赖,构造注入给 stage 与设置面板。
// 不变量:渲染侧只经此处装配,业务模块从不直接抓全局,只见构造注入的接口。

import { CharacterStage } from '../stage/character-stage.js';
import { ChatBubble } from '../stage/chat-bubble.js';
import { ModFrontendSlot } from '../stage/mod-frontend-slot.js';
import { Live2dRenderer } from '../../platform/render/live2d-renderer.js';
import { ImageRenderer } from '../../platform/render/image-renderer.js';

// 尺寸档位:控件加减号在这几档间移动,组合根只持档位顺序,不散落在多处按钮回调里。
export const SIZE_PRESETS = [200, 300, 400, 500];


// 默认档位下标:200/300/400/500 里的 300,启动与回退都用它。
const DEFAULT_SIZE_INDEX = 1;

// 鼠标跟踪归一化半径:光标到窗口中心的像素差除以它再钳到 -1 到 1。
const TRACK_RADIUS_PX = 300;

// 鼠标跟踪刷新周期(毫秒):每隔这么久取一次光标传给渲染适配。
const TRACK_INTERVAL_MS = 50;

// 头部跟踪里窗口位置缓存的兜底刷新周期,以跟踪拍数计:窗口移动远少于光标,故缓存复用、每若干拍刷一次,把每拍两次 IPC 降到一次。
const BOUNDS_REFRESH_TICKS = 10;

// 手势阈值:指针任一轴位移超过 movePx 像素才算拖动,否则在 clickMs 内抬起算一次轻点。拖动判定与轻点判定共用,避免散落。
const GESTURE_CONFIG = { movePx: 5, clickMs: 700 };

// 轻点回弹动画时长(毫秒):与 pet-window.css 的 pet-poke 动画一致,到时移除类。
const POKE_DURATION_MS = 400;

//// 把模型配置解析成「用哪种渲染适配加已定模型目录」的纯数据,不触 DOM [@x380kkm 2026-06-13] ////
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

//// 算尺寸档位邻接状态:能否变小变大与下一档尺寸,供控件与右键菜单共用 [@x380kkm 2026-06-13] ////
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

//// 把任意尺寸映射回最近的合法档位下标,菜单改尺寸后用它对齐控件 [@x380kkm 2026-06-13] ////
// 不在档位表里的尺寸回退到默认档,避免下标越界。
export function sizeIndexOf(size) {
  const found = SIZE_PRESETS.indexOf(size);
  return found < 0 ? DEFAULT_SIZE_INDEX : found;
}

//// 把光标与窗口边界换算成钳在 -1 到 1 的跟踪坐标,渲染适配据此偏转头部 [@x380kkm 2026-06-13] ////
// cursor 为屏幕坐标 {x,y},bounds 为窗口 {x,y,width,height};以窗口中心为原点按半径归一化。
export function trackVector(cursor, bounds) {
  const centerX = bounds.x + bounds.width / 2;
  const centerY = bounds.y + bounds.height / 2;
  return {
    x: clampUnit((cursor.x - centerX) / TRACK_RADIUS_PX),
    y: clampUnit((cursor.y - centerY) / TRACK_RADIUS_PX)
  };
}

//// 把一次指针抬起判定成点击、长按或拖拽,交互上报据此分类 [@x380kkm 2026-06-13] ////
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

//// 判定指针相对起点的位移是否已超过拖动阈值 [@x380kkm 2026-06-14] ////
// start 与 current 为屏幕坐标 {x,y};任一轴位移超过 movePx 即认为进入拖动,未超过则仍按轻点对待。
export function movementExceeds(start, current, movePx) {
  return Math.abs(current.x - start.x) > movePx || Math.abs(current.y - start.y) > movePx;
}

//// 把 (group, index) 动作信号反查成配置里的语义动作名 [@x380kkm 2026-06-13] ////
// play-motion 通道按底层 group 与 index 发动作,渲染适配只认语义名;在组合根据配置把 group 与 index 翻成语义名。
// 配置 motionEmotions 形如 [{name, group, index}];查不到返回空,调用方据此跳过。
export function actionNameForMotion(modelConfig, group, index) {
  const table = (modelConfig && modelConfig.motionEmotions) || [];
  const hit = table.find((m) => m.group === group && m.index === index);
  return hit ? hit.name : null;
}

//// 把下标钳到档位表的合法范围 [@x380kkm 2026-06-13] ////
function clampIndex(index) {
  if (index < 0) return 0;
  if (index > SIZE_PRESETS.length - 1) return SIZE_PRESETS.length - 1;
  return index;
}

//// 把值钳到 -1 到 1 [@x380kkm 2026-06-13] ////
function clampUnit(value) {
  if (value < -1) return -1;
  if (value > 1) return 1;
  return value;
}

//// 按模型计划造真实渲染适配:live2d 起 PIXI 与 Cubism、image 接图片元素、none 给空适配 [@x380kkm 2026-06-13] ////
// env 注入浏览器侧全局:{ PIXI, Live2DModel, doc, fetchJson }。
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

//// 造 live2d 适配:起 PIXI 应用、加载模型、贴合画布、加表情、挂每帧应用 [@x380kkm 2026-06-13] ////
async function makeLive2dAdapter(plan, env) {
  const { PIXI, Live2DModel, doc, fetchJson } = env;
  const canvas = doc.getElementById('live2d-canvas');

  if (Live2DModel && typeof Live2DModel.registerTicker === 'function') {
    Live2DModel.registerTicker(PIXI.Ticker);
  }

  // 分辨率封顶 1.5:高分屏(devicePixelRatio=2)按原值会在小窗口里分配两倍像素缓冲,填充与采样开销大;
  // 3 寸窗口里 1.5 与 2 的锐度肉眼难辨,封顶省约四成开销。抗锯齿仅在非高分屏开,高分屏的原生过采样已够。
  const dpr = (doc.defaultView && doc.defaultView.devicePixelRatio) || 1;
  const pixiApp = new PIXI.Application({
    view: canvas, transparent: true, autoStart: true,
    width: env.width || (doc.defaultView && doc.defaultView.innerWidth) || 300,
    height: env.height || (doc.defaultView && doc.defaultView.innerHeight) || 300,
    backgroundAlpha: 0, resolution: Math.min(dpr, 1.5),
    autoDensity: true, antialias: dpr < 2
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

//// 造 image 适配:取页面图片元素,隐藏画布,接图片渲染器 [@x380kkm 2026-06-13] ////
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

//// 造空适配:无模型时只兑现接口,什么都不做 [@x380kkm 2026-06-13] ////
function makeNullAdapter() {
  return { playAction() {}, revertAction() {}, setTalking() {}, setTrack() {}, dispose() {} };
}
//// /造空适配 ////

//// 给渲染器补上 setTrack 与 setTalking,使其满足 stage-boot 调用的适配接口 [@x380kkm 2026-06-13] ////
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

//// 把模型目录与 model3.json 文件名拼成可加载的 file:// 地址 [@x380kkm 2026-06-13] ////
// 已是 file:// 或 http 的目录原样用;否则转成 file:/// 并把反斜杠换成正斜杠。
function modelFileUrl(modelDir, modelJsonFile) {
  let base = modelDir || '';
  if (!base.startsWith('file://') && !base.startsWith('http')) {
    base = 'file:///' + base.replace(/\\/g, '/');
  }
  return base + '/' + modelJsonFile;
}
//// /把模型目录与 model3.json 文件名拼成可加载的 file:// 地址 ////

//// 把模型 contain 进整个画布并居中,完整不裁、不留空白带 [@x380kkm 2026-06-14] ////
// 用 pixiApp.screen 的 CSS 像素尺寸而非 renderer.width:后者在高分屏按 devicePixelRatio 放大(如 1.75 倍),
// 会把模型缩放与定位都按设备像素算,导致模型放大且偏出窗口被裁。
// 按「整宽」与「整高」都放得下的较小比例等比缩放(contain),保证模型完整可见且尽量占满窗口。
function fitModel(model, pixiApp) {
  const screen = pixiApp.screen || { width: pixiApp.renderer.width, height: pixiApp.renderer.height };
  const w = screen.width;
  const h = screen.height;
  const origW = model.width || w;
  const origH = model.height || h;
  const scale = Math.min(w / origW, h / origH);
  model.scale.set(scale);
  model.x = w / 2;
  model.y = h / 2;
}
//// /把模型 contain 进整个画布并居中 ////

//// 从舞台 DOM 装配 CharacterStage 的协作者:气泡视图、mod 前端槽、舞台尺寸 [@x380kkm 2026-06-13] ////
// doc 为承载舞台的文档;从 desktop-pet.html 取容器元素,缺失的元素以空安全方式降级。
//   stageElement   #pet-container,整窗覆盖层,作 mod 槽与气泡的布局基准
//   chatBubble     ChatBubble 接 #stage-bubble 框与 #stage-bubble-text 文本元素
//   modSlot        ModFrontendSlot 接 #mod-frontend-slot 槽元素与沙箱宿主
//   stageSize      取舞台元素当前像素尺寸,作表达区预算的基准
// 气泡是整窗覆盖层内的浮层,不改 OS 窗口尺寸,故 resizeWindow 给无害默认。
// sandboxHost 仅在 mod 嵌入时才被调用,启动期不触发;此处可不注入,槽只存引用。
function buildCharacterStage(doc, sandboxHost) {
  const stageElement = doc.getElementById('pet-container');
  const chatBubble = new ChatBubble({
    frameElement: doc.getElementById('stage-bubble'),
    textElement: doc.getElementById('stage-bubble-text')
  });
  const modSlot = new ModFrontendSlot({
    slotElement: doc.getElementById('mod-frontend-slot'),
    sandboxHost
  });
  const rect = stageElement && typeof stageElement.getBoundingClientRect === 'function'
    ? stageElement.getBoundingClientRect()
    : { width: 0, height: 0 };
  const stageSize = { width: Math.round(rect.width), height: Math.round(rect.height) };
  return new CharacterStage({ stageElement, stageSize, modSlot, chatBubble });
}
//// /从舞台 DOM 装配 CharacterStage 的协作者 ////

//// 由起点窗口位置、起点与当前光标的屏幕坐标算出拖动后的窗口位置 [@x380kkm 2026-06-14] ////
// 实测确证:Electron 渲染进程的 MouseEvent.screenX/screenY 与主进程 screen.getCursorScreenPoint() 数值相等,
// 两者同为 DIP 逻辑像素(并非物理像素),与窗口 getBounds/setPosition 口径一致。故光标位移一比一叠加到起点窗口位置即可,
// 不做任何 devicePixelRatio 换算。
export function dragTargetPosition(startBounds, startCursor, currentCursor) {
  return {
    x: Math.round(startBounds.x + (currentCursor.x - startCursor.x)),
    y: Math.round(startBounds.y + (currentCursor.y - startCursor.y))
  };
}
//// /由起点窗口位置与光标屏幕坐标算出拖动后的窗口位置 ////

//// 给舞台元素加一次轻点回弹:加 poked 类触发 CSS 动画,到时移除以便再次触发 [@x380kkm 2026-06-14] ////
// element 为承载模型画面的舞台元素(#pet-container);view 提供 setTimeout。
// 先移除再读一次布局强制回流,使连续轻点也能从头重放动画,而非因类已在而无动作。
export function applyPokeEffect(element, view, durationMs = POKE_DURATION_MS) {
  if (!element || !element.classList) return;
  element.classList.remove('poked');
  void element.offsetWidth;
  element.classList.add('poked');
  const setTimer = (view && typeof view.setTimeout === 'function') ? view.setTimeout.bind(view) : setTimeout;
  setTimer(() => { element.classList.remove('poked'); }, durationMs);
}
//// /给舞台元素加一次轻点回弹 ////

//// 在舞台上挂 JS 拖动与轻点:按下记锚点,位移过阈才改窗口位置;落控件不拖,松手按手势分派拖动或轻点 [@x380kkm 2026-06-14] ////
// 在舞台上用 JS 监听拖动并改窗口位置。
// 坐标全程换算到 DIP(见 dragTargetPosition)消除高分屏飘移;位移未过阈前不动窗口,避免轻点时的微小抖动把窗口带偏。
// 真正拖动时移动只记最新光标,由 requestAnimationFrame 每帧最多发一次 setWindowPosition,避免 mousemove 高频刷 IPC 造成卡顿。
// callbacks.onMoved 在拖动松手后调用,供调用方刷新头部跟踪用的窗口位置缓存;callbacks.onTap 在原地轻点抬起时调用,触发非语义回弹反馈。
function setupWindowDrag(doc, narrowApi, callbacks = {}) {
  const stageElement = doc && doc.getElementById('pet-container');
  if (!stageElement || !narrowApi || typeof narrowApi.setWindowPosition !== 'function') {
    return;
  }
  const view = doc.defaultView || (typeof window !== 'undefined' ? window : null);
  if (!view) return;
  const raf = typeof view.requestAnimationFrame === 'function'
    ? view.requestAnimationFrame.bind(view)
    : ((fn) => setTimeout(() => fn(), 16));
  const onMoved = typeof callbacks.onMoved === 'function' ? callbacks.onMoved : () => {};
  const onTap = typeof callbacks.onTap === 'function' ? callbacks.onTap : () => {};

  let armed = false;     // 指针已按下、尚未判定为拖动
  let moving = false;    // 位移已过阈,进入真正拖动并改窗口位置
  let startCursor = null;
  let startBounds = null;
  let startTime = 0;
  let latestCursor = null;
  let pending = false;

  function pump() {
    pending = false;
    if (!moving || !startBounds || !latestCursor) return;
    const target = dragTargetPosition(startBounds, startCursor, latestCursor);
    // 一并下达起点时锁定的宽高:透明无边窗在分数缩放(如 1.75)下,只发位置时会因取整误差逐次长大;
    // 用 setBounds 把尺寸钉在起点值,每帧重设同一尺寸,窗口不再随拖动膨胀。
    narrowApi.setWindowPosition(target.x, target.y, startBounds.width, startBounds.height);
  }

  stageElement.addEventListener('mousedown', async (event) => {
    // 落在控件按钮上不拖不戳,留给按钮自身的点击
    if (event.target && event.target.closest && event.target.closest('.controls')) return;
    startCursor = { x: event.screenX, y: event.screenY };
    latestCursor = startCursor;
    startTime = event.timeStamp;
    armed = true;
    moving = false;
    const bounds = await narrowApi.getWindowBounds();
    if (!bounds) { armed = false; return; }
    startBounds = bounds;
  });
  view.addEventListener('mousemove', (event) => {
    if (!armed) return;
    latestCursor = { x: event.screenX, y: event.screenY };
    if (!moving && movementExceeds(startCursor, latestCursor, GESTURE_CONFIG.movePx)) {
      moving = true;
    }
    if (moving && !pending) { pending = true; raf(pump); }
  });
  view.addEventListener('mouseup', (event) => {
    if (!armed) return;
    armed = false;
    moving = false;
    const down = { x: startCursor.x, y: startCursor.y, time: startTime };
    const up = { x: event.screenX, y: event.screenY, time: event.timeStamp };
    const gesture = classifyGesture(down, up, GESTURE_CONFIG);
    if (gesture.kind === 'drag') onMoved();
    else onTap(gesture);
  });
}
//// /在舞台上挂 JS 拖动与轻点 ////

//// 装配角色舞台:取窄接口与注入的渲染适配工厂,挂头部、控件、跟踪与事件订阅 [@x380kkm 2026-06-13] ////
// narrowApi 为 preload 暴露的窄接口(window.electronAPI);deps 注入可替换的协作者:
//   createRenderAdapter(plan)  按解析后的模型计划造 RenderAdapter,浏览器侧创建 PIXI 与 Cubism 后注入
//   stage                      角色表现层,缺省按 doc 现造一个装配好协作者的 CharacterStage
//   doc                        承载舞台的文档,缺省取浏览器全局 document,供 stage 装配取容器
//   sandboxHost                mod 沙箱宿主,注入给 mod 槽,缺省为 null,启动期不被调用
//   timers                     setInterval/clearInterval
// 返回 { dispose } 供宿主页卸载时停跟踪、释放适配。
export async function bootStage(narrowApi, deps = {}) {
  const createRenderAdapter = deps.createRenderAdapter;
  const doc = deps.doc || (typeof document !== 'undefined' ? document : null);
  const stage = deps.stage || buildCharacterStage(doc, deps.sandboxHost || null);
  // 默认定时器用箭头包一层:浏览器的 setInterval 要求 this 为 window,直接放进对象再 timers.setInterval 调用会触发 Illegal invocation。
  const timers = deps.timers || { setInterval: (fn, ms) => setInterval(fn, ms), clearInterval: (id) => clearInterval(id) };

  const lifecycle = {
    adapter: null,
    modelConfig: null,
    sizeIndex: DEFAULT_SIZE_INDEX,
    trackTimerId: null,
    // 缓存窗口位置供头部跟踪复用:首拍、每若干拍、拖动与改尺寸后刷新,避免每拍都走 IPC 取边界
    cachedBounds: null
  };

  //// 按窄接口读配置、解析模型计划、造适配并挂上头部 [@x380kkm 2026-06-13] ////
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

  //// 取一次窗口位置存入缓存,供头部跟踪复用 [@x380kkm 2026-06-14] ////
  async function refreshBounds() {
    if (typeof narrowApi.getWindowBounds === 'function') {
      lifecycle.cachedBounds = await narrowApi.getWindowBounds();
    }
  }

  //// 定时取光标、用缓存的窗口边界算跟踪坐标传给渲染适配,边界仅首拍与每若干拍刷新 [@x380kkm 2026-06-14] ////
  function startTracking() {
    stopTracking();
    let tickCount = 0;
    lifecycle.trackTimerId = timers.setInterval(async () => {
      const adapter = lifecycle.adapter;
      if (!adapter || typeof adapter.setTrack !== 'function') return;
      // 窗口位置变化远少于光标:首拍或每若干拍才刷边界,其余拍复用缓存,把每拍两次 IPC 降为一次
      tickCount++;
      if (!lifecycle.cachedBounds || tickCount % BOUNDS_REFRESH_TICKS === 0) {
        await refreshBounds();
      }
      const cursor = await narrowApi.getCursorPosition();
      const bounds = lifecycle.cachedBounds || { x: 0, y: 0, width: 0, height: 0 };
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

  //// 把领域信号订阅到表现层:表情、动作、说话、配置热重载 [@x380kkm 2026-06-13] ////
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

  //// 配置热重载:停跟踪、释放旧适配、按新配置重挂 [@x380kkm 2026-06-13] ////
  async function remountModel() {
    stopTracking();
    withAdapter((a) => a.dispose());
    lifecycle.adapter = null;
    await mountModel();
  }
  //// /配置热重载 ////

  //// 控件:加减改尺寸、设置、关闭,经窄接口下达,菜单改尺寸时回写档位 [@x380kkm 2026-06-13] ////
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
    // 窗口尺寸变了,跟踪用的中心点随之变,刷新缓存的窗口边界
    refreshBounds();
  }
  //// /控件 ////

  //// 对当前适配执行一个动作,无适配时静默跳过 [@x380kkm 2026-06-13] ////
  function withAdapter(action) {
    if (lifecycle.adapter) action(lifecycle.adapter);
  }

  if (narrowApi.onSizeChanged) {
    narrowApi.onSizeChanged((size) => controls.syncSizeFromMenu(size));
  }
  subscribeSignals();
  // 拖动松手后刷新缓存的窗口位置使头部跟踪以新位置算中心;原地轻点触发一次非语义回弹反馈,不上报、不调模型 AI
  setupWindowDrag(doc, narrowApi, {
    onMoved: () => { refreshBounds(); },
    onTap: (gesture) => {
      if (doc) applyPokeEffect(doc.getElementById('pet-container'), doc.defaultView);
      // 把原地轻点上报成身体交互事件:click 为短按、touch 为久按,交主进程驱动身体交互 mod 的意图
      if (gesture && typeof narrowApi.reportModInteraction === 'function') {
        narrowApi.reportModInteraction(gesture.kind, {});
      }
    }
  });
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
