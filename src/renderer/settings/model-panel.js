// audience: internal
// # model-panel
// 模型标签页子面板:模型模式、Live2D 导入、参数映射、画布锚点、图片文件夹、气泡框与图标。
// 不变量:以配置数据模型为真相来源,导入扫描结果先入模型再渲染;DOM 仅作模型的视图。

import { PARAM_LABELS, sortParamCandidates } from './settings-model.js';

//// 装配模型标签页的各项控件,绑定到配置数据模型与文件能力网关 [@busybee 2026-06-13] ////
export function mountModelPanel(ctx) {
  const { doc, model, gateway, t, showStatus } = ctx;

  doc.getElementById('model-type').value = model.model().type || 'none';
  updateModelCards(ctx);
  renderFromModel(ctx);

  //// 切换模型模式仅改模型类型与卡片可见性 [@busybee 2026-06-13] ////
  doc.getElementById('model-type').addEventListener('change', () => {
    model.model().type = doc.getElementById('model-type').value;
    updateModelCards(ctx);
  });

  //// 画布 Y 锚点滑块即时写回模型 [@busybee 2026-06-13] ////
  doc.getElementById('canvas-y-slider').addEventListener('input', (e) => {
    const value = parseFloat(e.target.value);
    doc.getElementById('canvas-y-val').textContent = value.toFixed(2);
    model.model().canvasYRatio = value;
  });

  //// 图片裁剪滑块即时写回模型 [@busybee 2026-06-13] ////
  doc.getElementById('image-crop-slider').addEventListener('input', (e) => {
    const value = parseFloat(e.target.value);
    doc.getElementById('image-crop-val').textContent = value.toFixed(2);
    model.model().imageCropScale = value;
  });

  doc.getElementById('btn-import-l2d').addEventListener('click', () => importLive2d(ctx));
  doc.getElementById('btn-select-image-folder').addEventListener('click', () => importImageFolder(ctx));
  doc.getElementById('btn-apply-suggested').addEventListener('click', () => {
    model.applySuggestedMapping();
    renderParamMapping(ctx);
    showStatus('model-status', t('status.suggestedApplied'), 'success');
  });

  //// 选择气泡框图片并落盘 [@busybee 2026-06-13] ////
  doc.getElementById('btn-select-bubble').addEventListener('click', async () => {
    const result = await gateway.model.selectBubbleImage();
    if (!result.success) return;
    doc.getElementById('bubble-info').textContent = `${t('status.bubbleInfo')}${result.filePath}`;
    await gateway.config.save({ bubble: { frameImagePath: result.filePath } });
  });

  //// 清除气泡框图片 [@busybee 2026-06-13] ////
  doc.getElementById('btn-clear-bubble').addEventListener('click', async () => {
    doc.getElementById('bubble-info').textContent = '';
    await gateway.config.save({ bubble: { frameImagePath: null } });
  });

  //// 选择应用图标并落盘 [@busybee 2026-06-13] ////
  doc.getElementById('btn-select-icon').addEventListener('click', async () => {
    const result = await gateway.model.selectAppIcon();
    if (!result.success) return;
    const preview = doc.getElementById('icon-preview');
    preview.src = result.iconPath;
    preview.style.display = '';
    doc.getElementById('icon-info').textContent = `${t('status.iconInfo')}${result.iconPath}`;
    await gateway.config.save({ appIcon: result.iconPath });
  });

  doc.getElementById('btn-save-model').addEventListener('click', () => saveModel(ctx));
  doc.getElementById('btn-clear-model').addEventListener('click', () => clearModel(ctx));
}

//// 按模型类型显隐 Live2D 与图片两组卡片 [@busybee 2026-06-13] ////
function updateModelCards(ctx) {
  const { doc } = ctx;
  const type = doc.getElementById('model-type').value;
  doc.getElementById('card-live2d').style.display = type === 'live2d' ? '' : 'none';
  doc.getElementById('card-param-mapping').style.display = type === 'live2d' ? '' : 'none';
  doc.getElementById('card-canvas-y').style.display = type === 'live2d' ? '' : 'none';
  doc.getElementById('card-image').style.display = type === 'image' ? '' : 'none';
}

//// 由模型快照重建当前模式的只读视图 [@busybee 2026-06-13] ////
function renderFromModel(ctx) {
  const { doc, model, t } = ctx;
  const config = model.model();
  if (config.type === 'live2d') {
    doc.getElementById('l2d-info').textContent =
      config.modelJsonFile ? `${t('status.modelInfo')}${config.modelJsonFile}` : '';
    doc.getElementById('canvas-y-slider').value = config.canvasYRatio || 0.60;
    doc.getElementById('canvas-y-val').textContent = (config.canvasYRatio || 0.60).toFixed(2);
    renderParamMapping(ctx);
  }
  if (config.type === 'image' && config.imageFolderPath) {
    doc.getElementById('folder-info').textContent = `${t('status.folderInfo')}${config.imageFolderPath}`;
    doc.getElementById('image-list-container').style.display = '';
    const cropScale = config.imageCropScale || 1.0;
    doc.getElementById('image-crop-slider').value = cropScale;
    doc.getElementById('image-crop-val').textContent = cropScale.toFixed(2);
    renderImageList(ctx);
  }
}

//// 选择文件夹、扫描模型、把结果写入模型后渲染各列表 [@busybee 2026-06-13] ////
async function importLive2d(ctx) {
  const { doc, model, gateway, t, showStatus } = ctx;
  const selected = await gateway.model.selectFolder();
  if (!selected.success) {
    if (selected.error !== 'cancelled') showStatus('model-status', selected.error, 'error');
    return;
  }
  const folderPath = selected.folderPath;
  const modelFile = selected.modelFiles[0];
  showStatus('model-status', t('status.scanning'), 'info');
  const scan = await gateway.model.scanModel(folderPath, modelFile);
  if (!scan.success) {
    showStatus('model-status', scan.error, 'error');
    return;
  }
  model.model().folderPath = folderPath;
  model.model().modelJsonFile = modelFile;
  model.applyScan(scan);
  doc.getElementById('model-type').value = 'live2d';
  updateModelCards(ctx);

  const motionCount = Object.values(scan.motions || {}).reduce((sum, arr) => sum + arr.length, 0);
  doc.getElementById('l2d-info').textContent = [
    `${t('status.modelInfo')}${scan.modelName}`,
    `${(scan.parameterIds || []).length} params`,
    `${scan.expressions.length} expr`,
    `${motionCount} motions`,
    `Moc: ${scan.validation.mocValid ? '✓' : '✗'}`,
    `Tex: ${scan.validation.texturesValid ? '✓' : '✗'}`
  ].join(' | ');

  renderParamMapping(ctx);
  if (ctx.onModelExpressionsChanged) ctx.onModelExpressionsChanged();

  if (doc.getElementById('copy-to-userdata').checked) {
    showStatus('model-status', t('status.copyingModel'), 'info');
    const copy = await gateway.model.copyToUserData(folderPath, scan.modelName);
    if (copy.success) {
      model.model().userDataModelPath = copy.userDataModelPath;
      showStatus('model-status', t('status.modelImported'), 'success');
    } else {
      showStatus('model-status', t('status.copyFailed') + copy.error, 'error');
    }
  } else {
    showStatus('model-status', t('status.modelSelected'), 'success');
  }
}

//// 选择图片文件夹、扫描图片、合并入模型后渲染列表 [@busybee 2026-06-13] ////
async function importImageFolder(ctx) {
  const { doc, model, gateway, t, showStatus } = ctx;
  const selected = await gateway.model.selectImageFolder();
  if (!selected.success) {
    if (selected.error !== 'cancelled') showStatus('model-status', selected.error, 'error');
    return;
  }
  const folderPath = selected.folderPath;
  doc.getElementById('model-type').value = 'image';
  updateModelCards(ctx);
  showStatus('model-status', t('status.scanningImages'), 'info');
  const scan = await gateway.model.scanImageFolder(folderPath);
  if (!scan.success) {
    showStatus('model-status', scan.error, 'error');
    return;
  }
  model.applyImageScan(folderPath, scan.images);
  doc.getElementById('folder-info').textContent =
    `${t('status.folderInfo')}${folderPath} (${scan.images.length})`;
  doc.getElementById('image-list-container').style.display = '';
  renderImageList(ctx);
  showStatus('model-status', t('status.imagesScanned').replace('{0}', scan.images.length), 'success');
}

//// 按模型快照与扫描候选渲染参数映射下拉,改动即写回模型 [@busybee 2026-06-13] ////
function renderParamMapping(ctx) {
  const { doc, model, t } = ctx;
  const container = doc.getElementById('param-mapping-list');
  container.innerHTML = '';
  const mapping = model.model().paramMapping || {};
  const suggested = model.scan.suggestedMapping || {};
  for (const [key, labelKey] of Object.entries(PARAM_LABELS)) {
    const mapped = mapping[key];
    const suggestedId = suggested[key] || null;
    const sorted = sortParamCandidates(model.scan.parameterIds, suggestedId);
    const row = doc.createElement('div');
    row.className = 'param-row';
    row.innerHTML = `
      <span class="param-label">${t(labelKey)}</span>
      <select class="param-select" data-key="${key}" style="flex:1;padding:4px;font-size:12px;border-radius:4px;">
        <option value="">${t('status.unmapped')}</option>
        ${sorted.map((id) =>
          `<option value="${id}" ${id === mapped ? 'selected' : ''}>${id}${id === suggestedId ? ' ★' : ''}</option>`
        ).join('')}
      </select>`;
    container.appendChild(row);
  }
  container.querySelectorAll('.param-select').forEach((select) => {
    select.addEventListener('change', () => {
      model.setParamMapping(select.dataset.key, select.value);
    });
  });
}

//// 按模型快照渲染图片分类列表,情绪名输入随勾选显隐 [@busybee 2026-06-13] ////
function renderImageList(ctx) {
  const { doc, model, t } = ctx;
  const container = doc.getElementById('image-list');
  container.innerHTML = '';
  const config = model.model();
  const files = config.imageFiles || [];
  const folderPath = (config.imageFolderPath || '').replace(/\\/g, '/');
  files.forEach((file, index) => {
    const row = doc.createElement('div');
    row.className = 'image-item';
    row.dataset.index = index;
    const emotionDisplay = file.emotionName ? '' : 'display:none;';
    row.innerHTML = `
      <img class="image-thumb" src="file:///${folderPath}/${encodeURIComponent(file.file)}" alt="${file.file}">
      <span style="flex:1;min-width:60px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;" title="${file.file}">${file.file}</span>
      <div class="cats">
        <label><input type="checkbox" class="cat-idle" ${file.idle ? 'checked' : ''}> ${t('img.idle')}</label>
        <label><input type="checkbox" class="cat-talking" ${file.talking ? 'checked' : ''}> ${t('img.talking')}</label>
        <label><input type="checkbox" class="cat-emotion" ${file.emotionName ? 'checked' : ''}> ${t('img.emotion')}</label>
        <input type="text" class="emotion-name" value="${file.emotionName || ''}" placeholder="${t('img.emotionPh')}" style="${emotionDisplay}">
      </div>`;
    const emotionCheckbox = row.querySelector('.cat-emotion');
    const emotionInput = row.querySelector('.emotion-name');
    emotionCheckbox.addEventListener('change', () => {
      emotionInput.style.display = emotionCheckbox.checked ? '' : 'none';
      if (!emotionCheckbox.checked) emotionInput.value = '';
    });
    container.appendChild(row);
  });
}

//// 从图片列表 DOM 收集分类开关写回模型 [@busybee 2026-06-13] ////
function collectImageFiles(ctx) {
  const { doc, model } = ctx;
  const files = model.model().imageFiles || [];
  doc.querySelectorAll('#image-list .image-item').forEach((item, index) => {
    if (!files[index]) return;
    files[index].idle = item.querySelector('.cat-idle').checked;
    files[index].talking = item.querySelector('.cat-talking').checked;
    const emotionCheckbox = item.querySelector('.cat-emotion');
    files[index].emotionName = emotionCheckbox.checked
      ? (item.querySelector('.emotion-name').value.trim() || '')
      : '';
  });
}

//// 收集图片模式数据、由情绪名生成表情后落盘模型配置 [@busybee 2026-06-13] ////
async function saveModel(ctx) {
  const { doc, model, gateway, t, showStatus } = ctx;
  const config = model.model();
  if (config.type === 'image' && config.imageFolderPath) {
    collectImageFiles(ctx);
    config.imageCropScale = parseFloat(doc.getElementById('image-crop-slider').value) || 1.0;
    model.syncExpressionsFromImages();
  }
  await gateway.config.save({ model: config });
  showStatus('model-status', t('status.modelSaved'), 'success');
}

//// 重置模型为缺省并刷新视图后落盘 [@busybee 2026-06-13] ////
async function clearModel(ctx) {
  const { doc, model, gateway, t, showStatus } = ctx;
  model.resetModel();
  await gateway.config.save({ model: model.model() });
  doc.getElementById('model-type').value = 'none';
  doc.getElementById('image-list').innerHTML = '';
  doc.getElementById('image-list-container').style.display = 'none';
  doc.getElementById('folder-info').textContent = '';
  updateModelCards(ctx);
  showStatus('model-status', t('status.modelCleared'), 'success');
}
