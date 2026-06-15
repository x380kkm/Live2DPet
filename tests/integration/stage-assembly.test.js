// audience: internal
// # stage-assembly.integration.test
// 行为仿真(纯逻辑层):用 mock 的 narrowApi(loadConfig 返回 live2d 配置)与 mock 的 createRenderAdapter,
// 跑真实 stage-boot 的 bootStage/mountModel 流程,断言解析出 live2d 计划、调用了 mountHead 并启动了 setTrack 跟踪;
// 再用 none 配置断言降级为无跟踪。DOM 经注入的假 stage 屏蔽,不触真实 PIXI、Cubism 与 window。

const { test } = require('node:test');
const assert = require('node:assert');

// stage-boot 是渲染侧 ESM,用动态 import 载入。
const loadBoot = () => import('../../src/renderer/boot/stage-boot.js');

//// 记录被挂头部的适配,setTrack 收到的跟踪坐标存起来 [@x380kkm 2026-06-13] ////
function recordingAdapter() {
  return {
    tracks: [],
    talkings: [],
    actions: [],
    disposed: false,
    playAction(name) { this.actions.push(name); },
    revertAction() { this.actions.push('__revert__'); },
    setTrack(x, y) { this.tracks.push([x, y]); },
    setTalking(v) { this.talkings.push(v); },
    dispose() { this.disposed = true; }
  };
}

//// 记录 mountHead 的假 stage,屏蔽真实 DOM 装配 [@x380kkm 2026-06-13] ////
function recordingStage() {
  return { mounted: null, mountHead(a) { this.mounted = a; } };
}

//// 假定时器:不真正计时,只把回调存起来供用例手动驱动 [@x380kkm 2026-06-13] ////
function fakeTimers() {
  let nextId = 1;
  const active = new Map();
  return {
    active,
    setInterval: (fn) => { const id = nextId++; active.set(id, fn); return id; },
    clearInterval: (id) => { active.delete(id); }
  };
}

//// 假窄接口:loadConfig 给定模型配置,光标与窗口边界给定值 [@x380kkm 2026-06-13] ////
function narrowApi(modelConfig, validation) {
  return {
    loadConfig: async () => ({ model: modelConfig }),
    validateModelPaths: async () => validation,
    getCursorPosition: async () => ({ x: 250, y: 100 }),
    getWindowBounds: async () => ({ x: 0, y: 0, width: 200, height: 200 })
  };
}

//// live2d 配置经校验后:解析出 live2d 计划、挂头部、启动跟踪 [@x380kkm 2026-06-13] ////
test('live2d 配置经 mountModel 解析出 live2d 计划、挂头部并启动跟踪', async () => {
  const { bootStage } = await loadBoot();
  const adapter = recordingAdapter();
  const stage = recordingStage();
  const timers = fakeTimers();

  let receivedPlan = null;
  const api = narrowApi(
    { type: 'live2d', folderPath: 'C:/m', modelJsonFile: 'a.model3.json' },
    { valid: true, modelDir: 'file:///C:/m' }
  );

  await bootStage(api, {
    createRenderAdapter: async (plan) => { receivedPlan = plan; return adapter; },
    stage,
    timers
  });

  // 解析出的计划为 live2d,模型目录取校验给的 modelDir。
  assert.strictEqual(receivedPlan.kind, 'live2d');
  assert.strictEqual(receivedPlan.resolvedModelDir, 'file:///C:/m');
  // 适配被挂上 stage 头部。
  assert.strictEqual(stage.mounted, adapter);
  // live2d 启动了定时跟踪。
  assert.strictEqual(timers.active.size, 1, 'live2d 应起一个跟踪定时器');

  // 手动跑一次跟踪回调:光标 (250,100) 相对中心 (100,100) 右移 150,半径 300 归一为 0.5。
  const tick = [...timers.active.values()][0];
  await tick();
  assert.deepStrictEqual(adapter.tracks, [[0.5, 0]], 'setTrack 收到归一化跟踪坐标');
});

//// none 配置:降级为空适配,不启动跟踪 [@x380kkm 2026-06-13] ////
test('none 配置降级为无跟踪并仍挂上头部', async () => {
  const { bootStage } = await loadBoot();
  const adapter = recordingAdapter();
  const stage = recordingStage();
  const timers = fakeTimers();

  let receivedPlan = null;
  const api = narrowApi({ type: 'none' }, null);

  await bootStage(api, {
    createRenderAdapter: async (plan) => { receivedPlan = plan; return adapter; },
    stage,
    timers
  });

  assert.strictEqual(receivedPlan.kind, 'none');
  assert.strictEqual(stage.mounted, adapter, '降级仍挂头部');
  // 非 live2d 不启动跟踪定时器。
  assert.strictEqual(timers.active.size, 0, 'none 不应起跟踪定时器');
});

//// live2d 配置校验失败:降级为 none,不启动跟踪 [@x380kkm 2026-06-13] ////
test('live2d 配置校验失败时降级为 none 并不启动跟踪', async () => {
  const { bootStage } = await loadBoot();
  const stage = recordingStage();
  const timers = fakeTimers();

  let receivedPlan = null;
  const api = narrowApi(
    { type: 'live2d', folderPath: 'C:/missing', modelJsonFile: 'a.model3.json' },
    { valid: false, error: '模型目录不存在' }
  );

  await bootStage(api, {
    createRenderAdapter: async (plan) => { receivedPlan = plan; return recordingAdapter(); },
    stage,
    timers
  });

  assert.strictEqual(receivedPlan.kind, 'none', '校验失败降级为 none');
  assert.deepStrictEqual(receivedPlan.config, { type: 'none' });
  assert.strictEqual(timers.active.size, 0);
});
