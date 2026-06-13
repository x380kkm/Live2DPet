// 运行:node --test tests/platform/preset-loader.test.js
// 验证预设加载与配置装配:有 modelConfig 用之、旧式单模型回退、预设读取与大类默认。
const { test } = require('node:test');
const assert = require('node:assert');
const { loadPresets, presetCategoryDefaults, buildStepModelConfig, DEFAULT_BASEURL, DEFAULT_MODEL } = require('../../src/platform/config/preset-loader');

test('有 modelConfig 时按其大类与步骤装配,带上 systemInjection', () => {
  const cfg = buildStepModelConfig({
    modelConfig: {
      categories: { llm: { preset: 'openai-chat', baseURL: 'b', apiKey: 'k', model: 'm' } },
      steps: { dialogue: { temperature: 0.9 } },
      systemInjection: '保持角色'
    }
  }, {});
  assert.strictEqual(cfg.categories.llm.model, 'm');
  assert.strictEqual(cfg.steps.dialogue.temperature, 0.9);
  assert.strictEqual(cfg.systemInjection, '保持角色');
});

test('旧式单 modelName 时三大类共用同一接入', () => {
  const cfg = buildStepModelConfig({ apiKey: 'k', baseURL: 'https://x/v1', modelName: 'old-model' }, {});
  for (const cat of ['vlm', 'llm', 'translate']) {
    assert.strictEqual(cfg.categories[cat].model, 'old-model');
    assert.strictEqual(cfg.categories[cat].baseURL, 'https://x/v1');
    assert.strictEqual(cfg.categories[cat].preset, 'openai-chat');
  }
});

test('全局层全空时回退到缺省端点与模型', () => {
  const cfg = buildStepModelConfig({}, {});
  assert.strictEqual(cfg.categories.llm.baseURL, DEFAULT_BASEURL);
  assert.strictEqual(cfg.categories.llm.model, DEFAULT_MODEL);
});

test('环境变量按大类装配,优先于文件 modelConfig', () => {
  const env = {
    LIVE2DPET_VLM_KEY: 'vk', LIVE2DPET_VLM_BASEURL: 'https://reelxai.com/v1', LIVE2DPET_VLM_MODEL: 'gemini-3.5-flash',
    LIVE2DPET_LLM_KEY: 'lk', LIVE2DPET_LLM_BASEURL: 'https://api.deepseek.com/v1', LIVE2DPET_LLM_MODEL: 'deepseek-v4-flash', LIVE2DPET_LLM_THINKING: 'off'
  };
  // 即便文件里有 modelConfig,环境变量也应胜出
  const cfg = buildStepModelConfig({ modelConfig: { categories: { llm: { model: '文件模型' } } } }, env);
  assert.strictEqual(cfg.categories.vlm.model, 'gemini-3.5-flash');
  assert.strictEqual(cfg.categories.vlm.apiKey, 'vk');
  assert.strictEqual(cfg.categories.llm.model, 'deepseek-v4-flash');
  assert.strictEqual(cfg.categories.llm.thinking, false);
  // 翻译类未单独给,沿用文本类
  assert.strictEqual(cfg.categories.translate.model, 'deepseek-v4-flash');
});

test('通用单接入环境变量让三大类共用同一模型', () => {
  const env = { LIVE2DPET_API_KEY: 'k', LIVE2DPET_BASE_URL: 'https://reelxai.com/v1', LIVE2DPET_MODEL: 'gemini-3.5-flash' };
  const cfg = buildStepModelConfig({}, env);
  for (const cat of ['vlm', 'llm', 'translate']) {
    assert.strictEqual(cfg.categories[cat].model, 'gemini-3.5-flash');
    assert.strictEqual(cfg.categories[cat].apiKey, 'k');
  }
});

test('无相关环境变量时回退到文件 modelConfig', () => {
  const cfg = buildStepModelConfig({ modelConfig: { categories: { llm: { model: '文件模型' } } } }, {});
  assert.strictEqual(cfg.categories.llm.model, '文件模型');
});

test('loadPresets 读不到文件时返回空表', () => {
  const presets = loadPresets('/nope.json', { readFileSync: () => { throw new Error('no'); } });
  assert.deepStrictEqual(presets, {});
});

test('loadPresets 解析 JSON 并供大类默认查询', () => {
  const json = JSON.stringify({ 'openai-chat': { baseURL: 'https://api/v1', categories: { vlm: { model: 'g' } } } });
  const presets = loadPresets('/x.json', { readFileSync: () => json });
  const d = presetCategoryDefaults(presets, 'openai-chat', 'vlm');
  assert.strictEqual(d.preset, 'openai-chat');
  assert.strictEqual(d.baseURL, 'https://api/v1');
  assert.strictEqual(d.model, 'g');
});

test('随仓库的 model-presets.json 含三套兼容预设', () => {
  const fs = require('fs');
  const path = require('path');
  const presets = loadPresets(path.join(__dirname, '../../assets/model-presets.json'), { readFileSync: fs.readFileSync });
  for (const name of ['openai-chat', 'claude', 'openai-responses']) {
    assert.ok(presets[name], `应含预设 ${name}`);
    assert.ok(presets[name].baseURL);
  }
});
