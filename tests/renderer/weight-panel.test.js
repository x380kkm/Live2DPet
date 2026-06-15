// audience: internal
// # weight-panel.test
// 验证动作权重子面板纯逻辑:缺配置填缺省、有配置填已存值、保存把两值收敛成非负数并入全局配置落盘。
// DOM 用最小 mock 注入,记录点击处理器以便触发;不验证真实渲染。
// 运行: node --test tests/renderer/weight-panel.test.js

const { test } = require('node:test');
const assert = require('node:assert');

// weight-panel 是 ESM(渲染侧),用动态 import 载入。
const loadPanel = () => import('../../src/renderer/settings/weight-panel.js');

//// 造一个最小文档 mock:getElementById 自建元素,addEventListener 记下处理器供 click 触发 [@x380kkm 2026-06-14] ////
function mockDoc() {
  const elements = {};
  function makeEl(id) {
    const handlers = {};
    return {
      id,
      value: '',
      addEventListener(type, fn) { handlers[type] = fn; },
      click() { return handlers.click && handlers.click(); }
    };
  }
  return {
    getElementById(id) {
      if (!elements[id]) elements[id] = makeEl(id);
      return elements[id];
    }
  };
}

//// 造一份子面板上下文:数据模型、记录落盘与状态的网关与回调 [@x380kkm 2026-06-14] ////
function makeCtx(config, saved, statuses) {
  return {
    doc: mockDoc(),
    model: { config },
    gateway: { config: { save: async (patch) => { saved.push(patch); } } },
    t: (key) => key,
    showStatus: (id, message, type) => statuses.push({ id, message, type })
  };
}

test('缺配置时填入缺省权重', async () => {
  const { mountWeightPanel, DEFAULT_DIALOGUE_WEIGHT, DEFAULT_MOD_WEIGHT } = await loadPanel();
  const ctx = makeCtx({}, [], []);
  mountWeightPanel(ctx);
  assert.strictEqual(ctx.doc.getElementById('action-weight-dialogue').value, DEFAULT_DIALOGUE_WEIGHT);
  assert.strictEqual(ctx.doc.getElementById('action-weight-mod').value, DEFAULT_MOD_WEIGHT);
});

test('有配置时填入已存权重', async () => {
  const { mountWeightPanel } = await loadPanel();
  const ctx = makeCtx({ actionWeightDialogue: 600, actionWeightMod: 400 }, [], []);
  mountWeightPanel(ctx);
  assert.strictEqual(ctx.doc.getElementById('action-weight-dialogue').value, 600);
  assert.strictEqual(ctx.doc.getElementById('action-weight-mod').value, 400);
});

test('保存把两值并入全局配置落盘并报状态', async () => {
  const { mountWeightPanel } = await loadPanel();
  const saved = [];
  const statuses = [];
  const config = {};
  const ctx = makeCtx(config, saved, statuses);
  mountWeightPanel(ctx);
  ctx.doc.getElementById('action-weight-dialogue').value = '900';
  ctx.doc.getElementById('action-weight-mod').value = '150';
  await ctx.doc.getElementById('btn-save-weights').click();
  assert.deepStrictEqual(saved[0], { actionWeightDialogue: 900, actionWeightMod: 150 });
  assert.strictEqual(config.actionWeightDialogue, 900);
  assert.strictEqual(config.actionWeightMod, 150);
  assert.strictEqual(statuses[0].id, 'weight-status');
});

test('非法或负输入回退到缺省权重', async () => {
  const { mountWeightPanel, DEFAULT_DIALOGUE_WEIGHT, DEFAULT_MOD_WEIGHT } = await loadPanel();
  const saved = [];
  const ctx = makeCtx({}, saved, []);
  mountWeightPanel(ctx);
  ctx.doc.getElementById('action-weight-dialogue').value = '不是数';
  ctx.doc.getElementById('action-weight-mod').value = '-5';
  await ctx.doc.getElementById('btn-save-weights').click();
  assert.strictEqual(saved[0].actionWeightDialogue, DEFAULT_DIALOGUE_WEIGHT);
  assert.strictEqual(saved[0].actionWeightMod, DEFAULT_MOD_WEIGHT);
});
