// 运行:node --test tests/domain/step-catalog.test.js
// 验证步骤目录的契约:每步恰属一个大类、默认参数齐备、出厂清单可枚举。
const { test } = require('node:test');
const assert = require('node:assert');
const { Category, StepId, STEP_CATEGORY, STEP_DEFAULTS, builtinSteps } = require('../../src/shared/step-catalog');

test('每个步骤都归属一个合法大类', () => {
  const valid = new Set(Object.values(Category));
  for (const id of Object.values(StepId)) {
    assert.ok(valid.has(STEP_CATEGORY[id]), `${id} 应有合法大类`);
  }
});

test('每个步骤都有温度与最大 token 默认', () => {
  for (const id of Object.values(StepId)) {
    const d = STEP_DEFAULTS[id];
    assert.strictEqual(typeof d.temperature, 'number', `${id} 缺温度`);
    assert.strictEqual(typeof d.maxTokens, 'number', `${id} 缺最大 token`);
  }
});

test('路由与情绪选择默认温度为 0,台词与反应为 1.3', () => {
  assert.strictEqual(STEP_DEFAULTS[StepId.IntentRoute].temperature, 0.0);
  assert.strictEqual(STEP_DEFAULTS[StepId.EmotionSelect].temperature, 0.0);
  assert.strictEqual(STEP_DEFAULTS[StepId.Dialogue].temperature, 1.3);
  assert.strictEqual(STEP_DEFAULTS[StepId.Reaction].temperature, 1.3);
});

test('截图两步归 vlm、翻译归 translate、其余归 llm', () => {
  assert.strictEqual(STEP_CATEGORY[StepId.KeyframeSelect], Category.Vlm);
  assert.strictEqual(STEP_CATEGORY[StepId.SituationExtract], Category.Vlm);
  assert.strictEqual(STEP_CATEGORY[StepId.Translate], Category.Translate);
  assert.strictEqual(STEP_CATEGORY[StepId.Dialogue], Category.Llm);
  assert.strictEqual(STEP_CATEGORY[StepId.ModGenerate], Category.Llm);
});

test('出厂清单逐条带 id、大类、标签、默认参数', () => {
  const steps = builtinSteps();
  assert.strictEqual(steps.length, Object.values(StepId).length);
  for (const step of steps) {
    assert.ok(step.id && step.category && step.label && step.defaults);
  }
});
