// 运行:node --test tests/domain/step-model-config.test.js
// 验证两层解析的契约:模型身份跟随大类、开关可单独覆盖、行为参数以步骤为先、注入合并。
const { test } = require('node:test');
const assert = require('node:assert');
const { StepModelConfig } = require('../../src/platform/llm/step-model-config');

//// 一份大类齐全、步骤少量覆盖的样例配置 [@x380kkm 2026-06-13] ////
function sampleConfig() {
  return {
    categories: {
      vlm: { preset: 'openai-chat', baseURL: 'https://vlm.test/v1', apiKey: 'vk', model: 'gemini-3.5-flash' },
      llm: { preset: 'openai-chat', baseURL: 'https://llm.test/v1', apiKey: 'lk', model: 'deepseek-v4-flash', thinking: false },
      translate: { preset: 'openai-chat', baseURL: 'https://llm.test/v1', apiKey: 'lk', model: 'deepseek-v4-flash' }
    },
    steps: {}
  };
}

test('台词步骤默认跟随 llm 大类的模型,温度取出厂 1.3', () => {
  const c = new StepModelConfig(sampleConfig());
  const r = c.resolve('dialogue');
  assert.strictEqual(r.model, 'deepseek-v4-flash');
  assert.strictEqual(r.baseURL, 'https://llm.test/v1');
  assert.strictEqual(r.temperature, 1.3);
  assert.strictEqual(r.thinking, false);
});

test('路由步骤即便随 llm 大类,温度仍是出厂 0', () => {
  const c = new StepModelConfig(sampleConfig());
  assert.strictEqual(c.resolve('intentRoute').temperature, 0.0);
});

test('截图步骤跟随 vlm 大类的模型', () => {
  const c = new StepModelConfig(sampleConfig());
  assert.strictEqual(c.resolve('situationExtract').model, 'gemini-3.5-flash');
});

test('关闭跟随开关后该步骤改用自己的模型,缺字段回退大类', () => {
  const cfg = sampleConfig();
  cfg.steps.dialogue = { followCategory: false, model: 'claude-opus-4-7' };
  const r = new StepModelConfig(cfg).resolve('dialogue');
  assert.strictEqual(r.model, 'claude-opus-4-7');
  // 步骤没给 baseURL,回退到 llm 大类
  assert.strictEqual(r.baseURL, 'https://llm.test/v1');
});

test('步骤温度覆盖大类温度,大类温度覆盖出厂默认', () => {
  const cfg = sampleConfig();
  cfg.categories.llm.temperature = 0.9;
  // 大类温度盖出厂:reaction 没有步骤温度,取大类 0.9
  assert.strictEqual(new StepModelConfig(cfg).resolve('reaction').temperature, 0.9);
  // 步骤温度盖大类:dialogue 显式 0.5
  cfg.steps.dialogue = { temperature: 0.5 };
  assert.strictEqual(new StepModelConfig(cfg).resolve('dialogue').temperature, 0.5);
});

test('extraBody 大类与步骤逐键合并,步骤盖大类', () => {
  const cfg = sampleConfig();
  cfg.categories.llm.extraBody = { top_p: 0.9, seed: 1 };
  cfg.steps.dialogue = { extraBody: { seed: 7 } };
  const r = new StepModelConfig(cfg).resolve('dialogue');
  assert.deepStrictEqual(r.extraBody, { top_p: 0.9, seed: 7 });
});

test('system 注入按全局、大类、步骤顺序合并非空段', () => {
  const cfg = sampleConfig();
  cfg.systemInjection = '全局指令';
  cfg.categories.llm.systemInjection = '大类指令';
  const r = new StepModelConfig(cfg).resolve('dialogue');
  assert.strictEqual(r.systemInjection, '全局指令\n\n大类指令');
});

test('未知步骤抛错', () => {
  assert.throws(() => new StepModelConfig(sampleConfig()).resolve('nope'), /未知步骤/);
});

test('最简配置只给大类、不给步骤时,各步仍取到出厂行为默认', () => {
  const c = new StepModelConfig({ categories: { llm: { model: 'm', baseURL: 'b', apiKey: 'k', preset: 'openai-chat' } } });
  assert.strictEqual(c.resolve('dialogue').temperature, 1.3);
  assert.strictEqual(c.resolve('intentRoute').temperature, 0.0);
});
