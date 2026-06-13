// audience: internal
// # model-config-panel
// 设置标签页子面板:按大类与步骤两层自由装配模型,友好填空与 JSON 高级两种模式。
// 不变量:以配置数据模型为真相来源;保存只发出 modelConfig 这一领域补丁;步骤列表由步骤目录镜像枚举,不硬编码散落。

import { AI_CATEGORIES, AI_STEP_CATALOG, MODEL_PRESETS } from './settings-model.js';

// 大类给用户看的中文名。
const CATEGORY_LABEL = { vlm: '截图(视觉语言模型)', llm: '文本(台词、路由等)', translate: '翻译' };

//// 装配模型路由面板:渲染大类与步骤填空、绑定模式切换与保存 [@busybee 2026-06-13] ////
export function mountModelConfigPanel(ctx) {
  const { doc, model } = ctx;
  const root = doc.getElementById('model-config-root');
  if (!root) return;

  renderForm(ctx);
  const injection = doc.getElementById('model-system-injection');
  if (injection) injection.value = model.modelConfig().systemInjection || '';

  bindModeSwitch(ctx);
  bindSave(ctx);
}

//// 按大类与步骤目录把当前配置渲染成填空控件 [@busybee 2026-06-13] ////
function renderForm(ctx) {
  const { doc, model } = ctx;
  const root = doc.getElementById('model-config-root');
  const mc = model.modelConfig();
  root.innerHTML = '';

  for (const category of AI_CATEGORIES) {
    const cat = mc.categories[category] || {};
    const card = doc.createElement('div');
    card.className = 'card';
    card.appendChild(heading(doc, CATEGORY_LABEL[category] || category));
    card.appendChild(presetSelect(doc, `mc-cat-${category}-preset`, '兼容预设', cat.preset));
    card.appendChild(textField(doc, `mc-cat-${category}-baseURL`, '接口地址(baseURL)', cat.baseURL));
    card.appendChild(textField(doc, `mc-cat-${category}-apiKey`, '密钥(apiKey)', cat.apiKey));
    card.appendChild(textField(doc, `mc-cat-${category}-model`, '模型名', cat.model));
    root.appendChild(card);
  }

  const stepCard = doc.createElement('div');
  stepCard.className = 'card';
  stepCard.appendChild(heading(doc, '各步骤(默认跟随大类,可单独覆盖)'));
  for (const step of AI_STEP_CATALOG) {
    stepCard.appendChild(stepRow(doc, step, mc.steps[step.id] || {}));
  }
  root.appendChild(stepCard);
}

//// 渲染一个步骤块:首行步骤名与跟随大类开关,次行并排的单独模型与单独温度 [@busybee 2026-06-14] ////
// 跟随大类勾选时禁用并淡化两个覆盖输入,直观表明覆盖只在关掉跟随后生效;外观类集中在 settings.css。
function stepRow(doc, step, override) {
  const block = doc.createElement('div');
  block.className = 'mc-step';

  const head = doc.createElement('div');
  head.className = 'mc-step-head';
  const name = doc.createElement('span');
  name.className = 'mc-step-name';
  name.innerHTML = `${step.label} <em>${step.category}</em>`;
  head.appendChild(name);

  const follow = doc.createElement('input');
  follow.type = 'checkbox';
  follow.id = `mc-step-${step.id}-follow`;
  // 缺省跟随大类:override.followCategory 显式为 false 才不勾
  follow.checked = override.followCategory !== false;
  const followLabel = doc.createElement('label');
  followLabel.className = 'mc-follow';
  followLabel.appendChild(follow);
  followLabel.appendChild(doc.createTextNode(' 跟随大类'));
  head.appendChild(followLabel);
  block.appendChild(head);

  const inputs = doc.createElement('div');
  inputs.className = 'mc-step-inputs';
  const modelInput = doc.createElement('input');
  modelInput.type = 'text';
  modelInput.id = `mc-step-${step.id}-model`;
  modelInput.className = 'mc-step-model';
  modelInput.placeholder = '单独模型名';
  if (override.model) modelInput.value = override.model;
  const tempInput = doc.createElement('input');
  tempInput.type = 'text';
  tempInput.id = `mc-step-${step.id}-temp`;
  tempInput.className = 'mc-step-temp';
  tempInput.placeholder = '温度';
  if (override.temperature !== undefined) tempInput.value = String(override.temperature);
  inputs.appendChild(modelInput);
  inputs.appendChild(tempInput);
  block.appendChild(inputs);

  const syncDisabled = () => {
    const off = follow.checked;
    modelInput.disabled = off;
    tempInput.disabled = off;
    inputs.classList.toggle('is-following', off);
  };
  follow.addEventListener('change', syncDisabled);
  syncDisabled();

  return block;
}

//// 把填空控件里的值收回数据模型 [@busybee 2026-06-13] ////
function collectForm(ctx) {
  const { doc, model } = ctx;
  for (const category of AI_CATEGORIES) {
    model.setCategoryModel(category, {
      preset: valueOf(doc, `mc-cat-${category}-preset`),
      baseURL: valueOf(doc, `mc-cat-${category}-baseURL`),
      apiKey: valueOf(doc, `mc-cat-${category}-apiKey`),
      model: valueOf(doc, `mc-cat-${category}-model`)
    });
  }
  for (const step of AI_STEP_CATALOG) {
    const follow = doc.getElementById(`mc-step-${step.id}-follow`);
    model.setStepFollowCategory(step.id, follow ? follow.checked : true);
    const override = {};
    const m = valueOf(doc, `mc-step-${step.id}-model`);
    if (m) override.model = m;
    const tempRaw = valueOf(doc, `mc-step-${step.id}-temp`);
    if (tempRaw !== '') {
      const temp = parseFloat(tempRaw);
      if (!Number.isNaN(temp)) override.temperature = temp;
    }
    if (Object.keys(override).length > 0) model.setStepOverride(step.id, override);
  }
  const injection = doc.getElementById('model-system-injection');
  if (injection) model.setSystemInjection(injection.value);
}

//// 绑定友好模式与 JSON 高级模式的切换 [@busybee 2026-06-13] ////
function bindModeSwitch(ctx) {
  const { doc, model } = ctx;
  const jsonCard = doc.getElementById('model-config-json-card');
  const root = doc.getElementById('model-config-root');
  const jsonArea = doc.getElementById('model-config-json');
  const formBtn = doc.getElementById('btn-mc-mode-form');
  const jsonBtn = doc.getElementById('btn-mc-mode-json');

  if (formBtn) formBtn.addEventListener('click', () => {
    // 从 JSON 切回填空时,若 JSON 合法则先并入数据模型再重渲
    if (jsonArea && jsonCard && jsonCard.style.display !== 'none') {
      tryParseJsonInto(model, jsonArea.value);
    }
    if (jsonCard) jsonCard.style.display = 'none';
    if (root) root.style.display = 'block';
    renderForm(ctx);
  });

  if (jsonBtn) jsonBtn.addEventListener('click', () => {
    collectForm(ctx);
    if (jsonArea) jsonArea.value = JSON.stringify(model.modelConfig(), null, 2);
    if (jsonCard) jsonCard.style.display = 'block';
    if (root) root.style.display = 'none';
  });
}

//// 绑定保存:按当前模式收集配置,落盘 modelConfig 领域补丁 [@busybee 2026-06-13] ////
function bindSave(ctx) {
  const { doc, model, gateway, t, showStatus } = ctx;
  const btn = doc.getElementById('btn-save-modelconfig');
  if (!btn) return;
  btn.addEventListener('click', async () => {
    const jsonCard = doc.getElementById('model-config-json-card');
    const jsonArea = doc.getElementById('model-config-json');
    if (jsonCard && jsonCard.style.display !== 'none' && jsonArea) {
      if (!tryParseJsonInto(model, jsonArea.value)) {
        showStatus('modelconfig-status', 'JSON 格式错误,未保存。', 'error');
        return;
      }
    } else {
      collectForm(ctx);
    }
    await gateway.config.save({ modelConfig: model.modelConfig() });
    showStatus('modelconfig-status', t('status.saved'), 'success');
  });
}

//// 试解析 JSON 并并入数据模型,成功返回真、失败返回假不改动 [@busybee 2026-06-13] ////
function tryParseJsonInto(model, text) {
  try {
    const parsed = JSON.parse(text);
    if (!parsed || typeof parsed !== 'object') return false;
    const mc = model.modelConfig();
    mc.categories = parsed.categories || {};
    mc.steps = parsed.steps || {};
    mc.systemInjection = parsed.systemInjection || '';
    return true;
  } catch (error) {
    return false;
  }
}

//// 取一个输入控件的去空白值,缺控件返回空串 [@busybee 2026-06-13] ////
function valueOf(doc, id) {
  const el = doc.getElementById(id);
  return el ? el.value.trim() : '';
}

//// 造一个三级标题 [@busybee 2026-06-13] ////
function heading(doc, text) {
  const h = doc.createElement('h3');
  h.textContent = text;
  return h;
}

//// 造一个带标签的文本输入,预填既有值 [@busybee 2026-06-13] ////
function textField(doc, id, labelText, value) {
  const wrap = doc.createElement('div');
  const label = doc.createElement('label');
  label.textContent = labelText;
  const input = doc.createElement('input');
  input.type = 'text';
  input.id = id;
  if (value) input.value = value;
  wrap.appendChild(label);
  wrap.appendChild(input);
  return wrap;
}

//// 造一个预设下拉,选中既有预设 [@busybee 2026-06-13] ////
function presetSelect(doc, id, labelText, value) {
  const wrap = doc.createElement('div');
  const label = doc.createElement('label');
  label.textContent = labelText;
  const select = doc.createElement('select');
  select.id = id;
  for (const preset of MODEL_PRESETS) {
    const option = doc.createElement('option');
    option.value = preset;
    option.textContent = preset;
    if (preset === value) option.selected = true;
    select.appendChild(option);
  }
  wrap.appendChild(label);
  wrap.appendChild(select);
  return wrap;
}
