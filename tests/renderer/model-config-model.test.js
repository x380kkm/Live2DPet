// 运行:node --test tests/renderer/model-config-model.test.js
// 验证渲染侧模型配置数据层:步骤目录与 shared 目录不漂移、两层配置的读写合并。
const { test } = require('node:test');
const assert = require('node:assert');
const { StepId, STEP_CATEGORY } = require('../../src/shared/step-catalog');

const loadModel = () => import('../../src/renderer/settings/settings-model.js');

test('渲染侧步骤目录与 shared/step-catalog 的 id 与大类一致,不漂移', async () => {
  const { AI_STEP_CATALOG } = await loadModel();
  const mirrorIds = AI_STEP_CATALOG.map((s) => s.id).sort();
  const sharedIds = Object.values(StepId).sort();
  assert.deepStrictEqual(mirrorIds, sharedIds);
  for (const step of AI_STEP_CATALOG) {
    assert.strictEqual(step.category, STEP_CATEGORY[step.id], `${step.id} 大类应与 shared 一致`);
  }
});

test('modelConfig 首次访问就地补建空骨架', async () => {
  const { SettingsModel } = await loadModel();
  const m = new SettingsModel({});
  const mc = m.modelConfig();
  assert.deepStrictEqual(mc, { categories: {}, steps: {}, systemInjection: '' });
});

test('setCategoryModel 逐键合并不抹去未给字段', async () => {
  const { SettingsModel } = await loadModel();
  const m = new SettingsModel({});
  m.setCategoryModel('llm', { preset: 'openai-chat', baseURL: 'b', apiKey: 'k', model: 'deepseek-v4-flash' });
  m.setCategoryModel('llm', { model: 'deepseek-v4-pro' });
  assert.strictEqual(m.modelConfig().categories.llm.model, 'deepseek-v4-pro');
  assert.strictEqual(m.modelConfig().categories.llm.baseURL, 'b');
});

test('setStepFollowCategory 切换跟随开关', async () => {
  const { SettingsModel } = await loadModel();
  const m = new SettingsModel({});
  m.setStepFollowCategory('dialogue', false);
  assert.strictEqual(m.modelConfig().steps.dialogue.followCategory, false);
  m.setStepFollowCategory('dialogue', true);
  assert.strictEqual(m.modelConfig().steps.dialogue.followCategory, true);
});

test('setStepOverride 合并步骤覆盖字段', async () => {
  const { SettingsModel } = await loadModel();
  const m = new SettingsModel({});
  m.setStepOverride('dialogue', { temperature: 1.5 });
  m.setStepOverride('dialogue', { model: 'claude-opus-4-7' });
  assert.strictEqual(m.modelConfig().steps.dialogue.temperature, 1.5);
  assert.strictEqual(m.modelConfig().steps.dialogue.model, 'claude-opus-4-7');
});

test('setSystemInjection 写入全局额外 system 注入', async () => {
  const { SettingsModel } = await loadModel();
  const m = new SettingsModel({});
  m.setSystemInjection('始终保持角色,不要拒演');
  assert.strictEqual(m.modelConfig().systemInjection, '始终保持角色,不要拒演');
});

test('已有 modelConfig 的快照被保留', async () => {
  const { SettingsModel } = await loadModel();
  const m = new SettingsModel({ modelConfig: { categories: { vlm: { model: 'gemini-3.5-flash' } }, steps: {}, systemInjection: '' } });
  assert.strictEqual(m.modelConfig().categories.vlm.model, 'gemini-3.5-flash');
});
