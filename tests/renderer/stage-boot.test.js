// audience: internal
// # stage-boot.test
// 验证组合根的纯逻辑与装配生命周期:模型计划解析、尺寸档位仲裁、跟踪坐标、手势分类、动作名反查,
// 以及 bootStage 的订阅接线与释放。DOM 与 narrowApi 用 mock,不触真实 PIXI、Cubism 与 window。

const { test } = require('node:test');
const assert = require('node:assert');

// stage-boot 是 ESM(渲染侧),用动态 import 载入;一处缓存供各用例复用。
const loadBoot = () => import('../../src/renderer/boot/stage-boot.js');

//// resolveModelPlan:按类型与校验结果定渲染适配种类与模型目录 [@busybee 2026-06-13] ////
test('resolveModelPlan 对 live2d 校验通过给出 live2d 计划与解析目录', async () => {
  const { resolveModelPlan } = await loadBoot();
  const plan = resolveModelPlan(
    { type: 'live2d', folderPath: 'C:/m' },
    { valid: true, modelDir: 'file:///C:/m' }
  );
  assert.strictEqual(plan.kind, 'live2d');
  assert.strictEqual(plan.resolvedModelDir, 'file:///C:/m');
});

test('resolveModelPlan 对 live2d 校验失败降级为 none', async () => {
  const { resolveModelPlan } = await loadBoot();
  const plan = resolveModelPlan({ type: 'live2d' }, { valid: false, error: 'x' });
  assert.strictEqual(plan.kind, 'none');
  assert.deepStrictEqual(plan.config, { type: 'none' });
});

test('resolveModelPlan 对 image 与缺省类型分别给出 image 与 none', async () => {
  const { resolveModelPlan } = await loadBoot();
  assert.strictEqual(resolveModelPlan({ type: 'image' }, null).kind, 'image');
  assert.strictEqual(resolveModelPlan(undefined, null).kind, 'none');
  assert.strictEqual(resolveModelPlan({ type: 'whatever' }, null).kind, 'none');
});

test('resolveModelPlan 无 modelDir 时回退到配置 folderPath', async () => {
  const { resolveModelPlan } = await loadBoot();
  const plan = resolveModelPlan({ type: 'live2d', folderPath: 'D:/p' }, { valid: true });
  assert.strictEqual(plan.resolvedModelDir, 'D:/p');
});
//// /resolveModelPlan ////

//// resolveSizeStep 与 sizeIndexOf:档位仲裁与邻接状态 [@busybee 2026-06-13] ////
test('resolveSizeStep 变大时下标与尺寸前进一档并报可否继续', async () => {
  const { resolveSizeStep } = await loadBoot();
  const step = resolveSizeStep(1, 1);
  assert.strictEqual(step.index, 2);
  assert.strictEqual(step.size, 400);
  assert.strictEqual(step.canShrink, true);
  assert.strictEqual(step.canGrow, true);
});

test('resolveSizeStep 在边界停住:已最小不再变小、已最大不再变大', async () => {
  const { resolveSizeStep } = await loadBoot();
  const atMin = resolveSizeStep(0, -1);
  assert.strictEqual(atMin.index, 0);
  assert.strictEqual(atMin.canShrink, false);
  const atMax = resolveSizeStep(3, 1);
  assert.strictEqual(atMax.index, 3);
  assert.strictEqual(atMax.canGrow, false);
});

test('sizeIndexOf 把合法尺寸映射到下标、非法尺寸回退默认档', async () => {
  const { sizeIndexOf } = await loadBoot();
  assert.strictEqual(sizeIndexOf(400), 2);
  assert.strictEqual(sizeIndexOf(999), 1);
});
//// /resolveSizeStep 与 sizeIndexOf ////

//// trackVector:光标与窗口边界折成钳在 -1 到 1 的跟踪坐标 [@busybee 2026-06-13] ////
test('trackVector 以窗口中心为原点按半径归一化', async () => {
  const { trackVector } = await loadBoot();
  const bounds = { x: 0, y: 0, width: 200, height: 200 };
  // 中心 (100,100),光标右下 (250,100):x 差 150/300=0.5,y 差 0
  const v = trackVector({ x: 250, y: 100 }, bounds);
  assert.strictEqual(v.x, 0.5);
  assert.strictEqual(v.y, 0);
});

test('trackVector 把超出半径的偏移钳到 -1 或 1', async () => {
  const { trackVector } = await loadBoot();
  const bounds = { x: 0, y: 0, width: 100, height: 100 };
  const v = trackVector({ x: 1000, y: -1000 }, bounds);
  assert.strictEqual(v.x, 1);
  assert.strictEqual(v.y, -1);
});
//// /trackVector ////

//// dragTargetPosition:光标位移一比一叠加到起点窗口位置(screenX 与窗口坐标同为 DIP,实测确证) [@busybee 2026-06-14] ////
test('dragTargetPosition 把光标位移一比一叠加到起点窗口位置', async () => {
  const { dragTargetPosition } = await loadBoot();
  // 起点窗口 (1143,455);光标从 (1290,622) 移到 (897,289),左移 393、上移 333,窗口同量平移
  const t = dragTargetPosition({ x: 1143, y: 455 }, { x: 1290, y: 622 }, { x: 897, y: 289 });
  assert.strictEqual(t.x, 1143 + (897 - 1290));
  assert.strictEqual(t.y, 455 + (289 - 622));
});

test('dragTargetPosition 光标不动时窗口位置不变', async () => {
  const { dragTargetPosition } = await loadBoot();
  const t = dragTargetPosition({ x: 100, y: 200 }, { x: 50, y: 60 }, { x: 50, y: 60 });
  assert.strictEqual(t.x, 100);
  assert.strictEqual(t.y, 200);
});

//// classifyGesture:把一次指针抬起判定成点击、长按或拖拽 [@busybee 2026-06-13] ////
test('classifyGesture 位移超阈判为拖拽', async () => {
  const { classifyGesture } = await loadBoot();
  const g = classifyGesture(
    { x: 0, y: 0, time: 0 },
    { x: 20, y: 0, time: 100 },
    { movePx: 8, clickMs: 300 }
  );
  assert.strictEqual(g.kind, 'drag');
  assert.strictEqual(g.elapsed, 100);
});

test('classifyGesture 原地短停判为点击、原地久停判为长按', async () => {
  const { classifyGesture } = await loadBoot();
  const gesture = { movePx: 8, clickMs: 300 };
  const click = classifyGesture({ x: 0, y: 0, time: 0 }, { x: 2, y: 2, time: 100 }, gesture);
  assert.strictEqual(click.kind, 'click');
  const touch = classifyGesture({ x: 0, y: 0, time: 0 }, { x: 2, y: 2, time: 500 }, gesture);
  assert.strictEqual(touch.kind, 'touch');
});
//// /classifyGesture ////

//// movementExceeds:指针位移是否过拖动阈值,决定轻点与拖动的分界 [@busybee 2026-06-14] ////
test('movementExceeds 任一轴位移超过阈值即为真,微小抖动为假', async () => {
  const { movementExceeds } = await loadBoot();
  assert.strictEqual(movementExceeds({ x: 0, y: 0 }, { x: 6, y: 0 }, 5), true);
  assert.strictEqual(movementExceeds({ x: 0, y: 0 }, { x: 0, y: 6 }, 5), true);
  assert.strictEqual(movementExceeds({ x: 0, y: 0 }, { x: 3, y: 3 }, 5), false);
  assert.strictEqual(movementExceeds({ x: 10, y: 10 }, { x: 10, y: 10 }, 5), false);
});
//// /movementExceeds ////

//// applyPokeEffect:加 poked 类触发回弹动画,到时移除以便再次触发 [@busybee 2026-06-14] ////
test('applyPokeEffect 加 poked 类并在到时回调里移除', async () => {
  const { applyPokeEffect } = await loadBoot();
  // 假元素记录类的增删;假 view 把 setTimeout 回调存起来供手动触发
  const classes = new Set();
  const element = { classList: { add: (c) => classes.add(c), remove: (c) => classes.delete(c) } };
  let pendingTimer = null;
  const view = { setTimeout: (fn) => { pendingTimer = fn; return 1; } };
  applyPokeEffect(element, view, 400);
  assert.strictEqual(classes.has('poked'), true);
  // 触发到时回调,类被移除
  pendingTimer();
  assert.strictEqual(classes.has('poked'), false);
});

test('applyPokeEffect 对缺失元素静默跳过,不抛错', async () => {
  const { applyPokeEffect } = await loadBoot();
  assert.doesNotThrow(() => applyPokeEffect(null, null));
  assert.doesNotThrow(() => applyPokeEffect({}, null));
});
//// /applyPokeEffect ////

//// actionNameForMotion:旧式 (group, index) 反查语义动作名 [@busybee 2026-06-13] ////
test('actionNameForMotion 命中配置项时返回语义名、未命中返回空', async () => {
  const { actionNameForMotion } = await loadBoot();
  const config = { motionEmotions: [{ name: 'wave', group: 'TapBody', index: 1 }] };
  assert.strictEqual(actionNameForMotion(config, 'TapBody', 1), 'wave');
  assert.strictEqual(actionNameForMotion(config, 'TapBody', 9), null);
  assert.strictEqual(actionNameForMotion(null, 'TapBody', 1), null);
});
//// /actionNameForMotion ////

// 造一个记录调用的假渲染适配,覆盖语义接口加可选的跟踪与说话状态方法
function makeFakeAdapter() {
  return {
    actions: [],
    tracks: [],
    talkings: [],
    disposed: false,
    playAction(name) { this.actions.push(name); },
    revertAction() { this.actions.push('__revert__'); },
    setTrack(x, y) { this.tracks.push([x, y]); },
    setTalking(v) { this.talkings.push(v); },
    dispose() { this.disposed = true; }
  };
}

// 造一个记录订阅与调用的假窄接口,回调存起来供用例手动触发
function makeNarrowApi(overrides = {}) {
  const handlers = {};
  const calls = { setWindowSize: [], showSettings: 0, closePetWindow: 0 };
  const api = {
    handlers,
    calls,
    loadConfig: async () => ({ model: { type: 'live2d', motionEmotions: [{ name: 'wave', group: 'TapBody', index: 1 }] } }),
    validateModelPaths: async () => ({ valid: true, modelDir: 'file:///m' }),
    getCursorPosition: async () => ({ x: 0, y: 0 }),
    getWindowBounds: async () => ({ x: 0, y: 0, width: 200, height: 200 }),
    setWindowSize: (w, h) => calls.setWindowSize.push([w, h]),
    showSettings: () => { calls.showSettings++; },
    closePetWindow: () => { calls.closePetWindow++; },
    onPlayExpression: (cb) => { handlers.playExpression = cb; },
    onRevertExpression: (cb) => { handlers.revertExpression = cb; },
    onPlayMotion: (cb) => { handlers.playMotion = cb; },
    onTalkingStateChanged: (cb) => { handlers.talking = cb; },
    onModelConfigUpdate: (cb) => { handlers.configUpdate = cb; },
    onSizeChanged: (cb) => { handlers.sizeChanged = cb; },
    ...overrides
  };
  return api;
}

// 假定时器:不真正计时,只把回调存起来,测试不依赖时钟
function makeFakeTimers() {
  let nextId = 1;
  const active = new Map();
  return {
    active,
    setInterval: (fn) => { const id = nextId++; active.set(id, fn); return id; },
    clearInterval: (id) => { active.delete(id); }
  };
}

//// bootStage 装配:挂头部、订阅信号、释放 [@busybee 2026-06-13] ////
test('bootStage 读配置造适配并挂上 stage 头部', async () => {
  const { bootStage } = await loadBoot();
  const adapter = makeFakeAdapter();
  const stage = { mounted: null, mountHead(a) { this.mounted = a; } };
  const handle = await bootStage(makeNarrowApi(), {
    createRenderAdapter: async () => adapter,
    stage,
    timers: makeFakeTimers()
  });
  assert.strictEqual(stage.mounted, adapter);
  assert.strictEqual(handle.getAdapter(), adapter);
});

test('bootStage 把表情、回退、动作信号转成适配的语义动作调用', async () => {
  const { bootStage } = await loadBoot();
  const adapter = makeFakeAdapter();
  const api = makeNarrowApi();
  await bootStage(api, {
    createRenderAdapter: async () => adapter,
    stage: { mountHead() {} },
    timers: makeFakeTimers()
  });
  api.handlers.playExpression('happy');
  api.handlers.revertExpression();
  // 动作信号按底层 (group,index) 来,经反查映射成语义名 wave
  api.handlers.playMotion('TapBody', 1);
  // 反查不到的动作不触发任何调用
  api.handlers.playMotion('Nope', 7);
  assert.deepStrictEqual(adapter.actions, ['happy', '__revert__', 'wave']);
});

test('bootStage 对 live2d 启定时跟踪,定时回调把跟踪坐标喂给适配', async () => {
  const { bootStage } = await loadBoot();
  const adapter = makeFakeAdapter();
  const timers = makeFakeTimers();
  const api = makeNarrowApi({
    getCursorPosition: async () => ({ x: 250, y: 100 }),
    getWindowBounds: async () => ({ x: 0, y: 0, width: 200, height: 200 })
  });
  await bootStage(api, { createRenderAdapter: async () => adapter, stage: { mountHead() {} }, timers });
  assert.strictEqual(timers.active.size, 1);
  // 手动跑一次定时回调
  const tick = [...timers.active.values()][0];
  await tick();
  assert.deepStrictEqual(adapter.tracks, [[0.5, 0]]);
});

test('bootStage 控件加大尺寸经窄接口下达且在边界停住', async () => {
  const { bootStage } = await loadBoot();
  const api = makeNarrowApi();
  const handle = await bootStage(api, {
    createRenderAdapter: async () => makeFakeAdapter(),
    stage: { mountHead() {} },
    timers: makeFakeTimers()
  });
  handle.controls.grow();   // 默认档 1 → 2,尺寸 400
  handle.controls.grow();   // 2 → 3,尺寸 500
  handle.controls.grow();   // 已最大,不再下达
  assert.deepStrictEqual(api.calls.setWindowSize, [[400, 400], [500, 500]]);
});

test('bootStage 右键菜单改尺寸后控件按新档位继续仲裁', async () => {
  const { bootStage } = await loadBoot();
  const api = makeNarrowApi();
  const handle = await bootStage(api, {
    createRenderAdapter: async () => makeFakeAdapter(),
    stage: { mountHead() {} },
    timers: makeFakeTimers()
  });
  api.handlers.sizeChanged(200);  // 菜单设成最小档
  handle.controls.shrink();        // 已最小,不下达
  assert.deepStrictEqual(api.calls.setWindowSize, []);
  handle.controls.grow();          // 最小 → 300
  assert.deepStrictEqual(api.calls.setWindowSize, [[300, 300]]);
});

test('bootStage 说话状态信号转给支持说话方法的适配', async () => {
  const { bootStage } = await loadBoot();
  const adapter = makeFakeAdapter();
  const api = makeNarrowApi();
  await bootStage(api, {
    createRenderAdapter: async () => adapter,
    stage: { mountHead() {} },
    timers: makeFakeTimers()
  });
  api.handlers.talking(true);
  api.handlers.talking(false);
  assert.deepStrictEqual(adapter.talkings, [true, false]);
});

test('bootStage 配置热重载停旧跟踪、释放旧适配、按新配置重挂', async () => {
  const { bootStage } = await loadBoot();
  const first = makeFakeAdapter();
  const second = makeFakeAdapter();
  const built = [first, second];
  const timers = makeFakeTimers();
  const api = makeNarrowApi();
  const handle = await bootStage(api, {
    createRenderAdapter: async () => built.shift(),
    stage: { mountHead() {} },
    timers
  });
  assert.strictEqual(handle.getAdapter(), first);
  await api.handlers.configUpdate({});
  assert.strictEqual(first.disposed, true);
  assert.strictEqual(handle.getAdapter(), second);
});

test('bootStage dispose 停跟踪并释放适配', async () => {
  const { bootStage } = await loadBoot();
  const adapter = makeFakeAdapter();
  const timers = makeFakeTimers();
  const handle = await bootStage(makeNarrowApi(), {
    createRenderAdapter: async () => adapter,
    stage: { mountHead() {} },
    timers
  });
  handle.dispose();
  assert.strictEqual(adapter.disposed, true);
  assert.strictEqual(timers.active.size, 0);
  assert.strictEqual(handle.getAdapter(), null);
});
//// /bootStage 装配 ////
