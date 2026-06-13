// audience: internal
// # api-panel
// 设置标签页子面板:API 接入、翻译 API、检测频率、token 倍率、增强总闸。
// 不变量:以配置数据模型为真相来源;保存时只发出本领域的配置补丁,不重读整表。

import { tokenCountForMultiplier } from './settings-model.js';

//// 装配设置标签页的各项控件,绑定到配置数据模型与配置网关 [@busybee 2026-06-13] ////
export function mountApiPanel(ctx) {
  const { doc, model, gateway, t, showStatus } = ctx;
  const config = model.config;

  doc.getElementById('api-url').value = config.baseURL || '';
  doc.getElementById('api-key').value = config.apiKey || '';
  doc.getElementById('model-name').value = config.modelName || '';
  if (config.translation) {
    doc.getElementById('tl-api-url').value = config.translation.baseURL || '';
    doc.getElementById('tl-api-key').value = config.translation.apiKey || '';
    doc.getElementById('tl-model-name').value = config.translation.modelName || '';
  }
  if (config.interval != null) doc.getElementById('interval').value = config.interval;
  if (config.chatGap != null) doc.getElementById('chat-gap').value = config.chatGap;
  doc.getElementById('enhance-enabled').checked = (config.enhance && config.enhance.enabled) || false;
  renderTokenMultiplier(ctx, config.maxTokensMultiplier || 1.0);

  //// 保存主 API 接入设置 [@busybee 2026-06-13] ////
  doc.getElementById('btn-save-api').addEventListener('click', async () => {
    config.baseURL = doc.getElementById('api-url').value.trim();
    config.apiKey = doc.getElementById('api-key').value.trim();
    config.modelName = doc.getElementById('model-name').value.trim();
    await gateway.config.save({ baseURL: config.baseURL, apiKey: config.apiKey, modelName: config.modelName });
    showStatus('api-status', t('status.saved'), 'success');
  });

  //// 保存翻译 API 接入设置 [@busybee 2026-06-13] ////
  doc.getElementById('btn-save-tl').addEventListener('click', async () => {
    const translation = {
      baseURL: doc.getElementById('tl-api-url').value.trim(),
      apiKey: doc.getElementById('tl-api-key').value.trim(),
      modelName: doc.getElementById('tl-model-name').value.trim()
    };
    config.translation = translation;
    await gateway.config.save({ translation });
    showStatus('tl-status', t('status.saved'), 'success');
  });

  //// 保存检测频率与最小对话间隔 [@busybee 2026-06-13] ////
  doc.getElementById('btn-save-interval').addEventListener('click', async () => {
    config.interval = parseInt(doc.getElementById('interval').value);
    config.chatGap = parseInt(doc.getElementById('chat-gap').value);
    await gateway.config.save({ interval: config.interval, chatGap: config.chatGap });
  });

  //// 切换增强总闸 [@busybee 2026-06-13] ////
  doc.getElementById('enhance-enabled').addEventListener('change', async () => {
    const enabled = doc.getElementById('enhance-enabled').checked;
    if (!config.enhance) config.enhance = {};
    config.enhance.enabled = enabled;
    await gateway.config.save({ enhance: { enabled } });
  });

  //// 切换 token 倍率,即时落盘 [@busybee 2026-06-13] ////
  doc.querySelectorAll('.token-mult-btn').forEach((btn) => {
    btn.addEventListener('click', async () => {
      const multiplier = parseFloat(btn.dataset.mult);
      config.maxTokensMultiplier = multiplier;
      renderTokenMultiplier(ctx, multiplier);
      await gateway.config.save({ maxTokensMultiplier: multiplier });
    });
  });
}

//// 按当前倍率刷新按钮高亮与说明文字 [@busybee 2026-06-13] ////
function renderTokenMultiplier(ctx, multiplier) {
  const { doc, t } = ctx;
  doc.querySelectorAll('.token-mult-btn').forEach((btn) => {
    const value = parseFloat(btn.dataset.mult);
    btn.className = value === multiplier
      ? 'btn btn-primary btn-sm token-mult-btn'
      : 'btn btn-secondary btn-sm token-mult-btn';
  });
  const info = doc.getElementById('token-info');
  if (info) {
    const tokens = tokenCountForMultiplier(multiplier);
    info.textContent = t('enhance.tokens.info').replace('{0}', tokens).replace('{1}', multiplier);
  }
}
