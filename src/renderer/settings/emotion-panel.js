// audience: internal
// # emotion-panel
// 情绪标签页子面板:表情频率、表情列表、动作列表、缺省时长。
// 不变量:列表项以配置数据模型为真相来源,增删改写回模型;保存时一次性把面板值并入模型再落盘。

const { msToSeconds } = require('./settings-model');

//// 装配情绪标签页的频率、表情、动作三块并绑定到配置数据模型 [@busybee 2026-06-13] ////
function mountEmotionPanel(ctx) {
  const { doc, model, gateway, t, showStatus } = ctx;
  const config = model.config;

  if (config.emotionFrequency) doc.getElementById('emotion-frequency').value = config.emotionFrequency;
  if (config.allowSimultaneous) doc.getElementById('allow-simultaneous').checked = true;
  const modelConfig = model.model();
  if (modelConfig.defaultExpressionDuration) {
    doc.getElementById('default-expr-duration').value = modelConfig.defaultExpressionDuration / 1000;
  }
  if (modelConfig.defaultMotionDuration) {
    doc.getElementById('default-motion-duration').value = modelConfig.defaultMotionDuration / 1000;
  }
  renderExpressionList(ctx);
  renderMotionList(ctx);

  //// 保存表情频率与同时表现开关 [@busybee 2026-06-13] ////
  doc.getElementById('btn-save-emotion-freq').addEventListener('click', async () => {
    config.emotionFrequency = parseInt(doc.getElementById('emotion-frequency').value);
    config.allowSimultaneous = doc.getElementById('allow-simultaneous').checked;
    if (ctx.onEmotionFrequencyChanged) ctx.onEmotionFrequencyChanged(config.emotionFrequency, config.allowSimultaneous);
    await gateway.config.save({ allowSimultaneous: config.allowSimultaneous });
    showStatus('emotion-status', t('status.saved'), 'success');
  });

  //// 追加一个新表情项到模型并刷新列表 [@busybee 2026-06-13] ////
  doc.getElementById('btn-add-expr').addEventListener('click', () => {
    const m = model.model();
    if (!m.expressions) m.expressions = [];
    m.expressions.push({ name: t('status.newExpr'), label: t('status.newExpr'), file: '' });
    m.hasExpressions = true;
    renderExpressionList(ctx);
  });

  //// 追加一个新动作项到模型并刷新列表 [@busybee 2026-06-13] ////
  doc.getElementById('btn-add-motion').addEventListener('click', () => {
    const m = model.model();
    if (!m.motionEmotions) m.motionEmotions = [];
    const firstGroup = Object.keys(model.scan.motions)[0] || 'Default';
    m.motionEmotions.push({ name: t('status.newMotion'), group: firstGroup, index: 0 });
    renderMotionList(ctx);
  });

  doc.getElementById('btn-save-expressions').addEventListener('click', () => saveEmotions(ctx));
}

//// 按模型快照渲染表情列表,缺省时长留空作占位 [@busybee 2026-06-13] ////
function renderExpressionList(ctx) {
  const { doc, model, t } = ctx;
  const container = doc.getElementById('expression-list');
  container.innerHTML = '';
  const config = model.model();
  const expressions = config.expressions || [];
  const durations = config.expressionDurations || {};
  if (expressions.length === 0) {
    doc.getElementById('expr-hint').style.display = '';
    return;
  }
  doc.getElementById('expr-hint').style.display = 'none';
  expressions.forEach((expr, index) => {
    const row = doc.createElement('div');
    row.className = 'expr-item';
    row.innerHTML = `
      <input type="checkbox" class="expr-enabled" data-name="${expr.name}" checked>
      <input type="text" class="expr-name" value="${expr.name}" style="width:80px;padding:2px 4px;font-size:12px;" data-index="${index}">
      <span style="color:#888;font-size:11px;">${expr.file || ''}</span>
      <input type="number" class="expr-dur" value="${msToSeconds(durations[expr.name])}" placeholder="${t('status.default')}" step="0.5" min="0" style="width:60px;padding:2px 4px;font-size:12px;" data-name="${expr.name}">
      <span style="color:#888;font-size:11px;">${t('sec')}</span>
      <button class="btn btn-danger btn-sm expr-del" data-index="${index}" style="padding:2px 8px;">✕</button>`;
    container.appendChild(row);
  });
  container.querySelectorAll('.expr-del').forEach((btn) => {
    btn.addEventListener('click', () => {
      model.model().expressions.splice(parseInt(btn.dataset.index), 1);
      renderExpressionList(ctx);
    });
  });
}

//// 按模型快照渲染动作列表,分组下拉取自扫描结果 [@busybee 2026-06-13] ////
function renderMotionList(ctx) {
  const { doc, model, t } = ctx;
  const container = doc.getElementById('motion-list');
  container.innerHTML = '';
  const config = model.model();
  const motionEmotions = config.motionEmotions || [];
  const durations = config.motionDurations || {};
  if (motionEmotions.length === 0) {
    doc.getElementById('motion-hint').style.display = '';
    return;
  }
  doc.getElementById('motion-hint').style.display = 'none';
  const scannedMotions = model.scan.motions || {};
  const groupOptions = Object.keys(scannedMotions);
  motionEmotions.forEach((motion, index) => {
    const maxIndex = scannedMotions[motion.group] ? scannedMotions[motion.group].length - 1 : 99;
    const row = doc.createElement('div');
    row.className = 'expr-item';
    row.innerHTML = `
      <input type="checkbox" class="motion-enabled" data-name="${motion.name}" checked>
      <input type="text" class="motion-name" value="${motion.name}" style="width:80px;padding:2px 4px;font-size:12px;" data-index="${index}">
      <select class="motion-group" data-index="${index}" style="width:80px;padding:2px 4px;font-size:12px;">
        ${groupOptions.map((g) => `<option value="${g}" ${g === motion.group ? 'selected' : ''}>${g}</option>`).join('')}
        ${!groupOptions.includes(motion.group) ? `<option value="${motion.group}" selected>${motion.group}</option>` : ''}
      </select>
      <input type="number" class="motion-index" value="${motion.index}" min="0" max="${maxIndex}" style="width:45px;padding:2px 4px;font-size:12px;" data-index="${index}">
      <input type="number" class="motion-dur" value="${msToSeconds(durations[motion.name])}" placeholder="${t('status.default')}" step="0.5" min="0" style="width:60px;padding:2px 4px;font-size:12px;" data-name="${motion.name}">
      <span style="color:#888;font-size:11px;">${t('sec')}</span>
      <button class="btn btn-danger btn-sm motion-del" data-index="${index}" style="padding:2px 8px;">✕</button>`;
    container.appendChild(row);
  });
  container.querySelectorAll('.motion-del').forEach((btn) => {
    btn.addEventListener('click', () => {
      model.model().motionEmotions.splice(parseInt(btn.dataset.index), 1);
      renderMotionList(ctx);
    });
  });
}

//// 从两份列表 DOM 收集编辑项,经模型并入再落盘并通知情绪系统 [@busybee 2026-06-13] ////
async function saveEmotions(ctx) {
  const { doc, model, gateway, t, showStatus } = ctx;
  const edits = {
    expressions: collectExpressionEdits(doc, model),
    motions: collectMotionEdits(doc),
    defaultExpressionSeconds: doc.getElementById('default-expr-duration').value,
    defaultMotionSeconds: doc.getElementById('default-motion-duration').value
  };
  const enabledEmotions = model.applyEmotionEdits(edits);
  await gateway.config.save({ model: model.model(), enabledEmotions });
  if (ctx.onEmotionConfigSaved) ctx.onEmotionConfigSaved(model.model(), enabledEmotions);
  showStatus('save-emotion-status', t('status.exprSaved'), 'success');
}

//// 从表情列表 DOM 收集名字、时长、启用,对齐模型里既有的文件名 [@busybee 2026-06-13] ////
function collectExpressionEdits(doc, model) {
  const container = doc.getElementById('expression-list');
  const names = container.querySelectorAll('.expr-name');
  const durations = container.querySelectorAll('.expr-dur');
  const enabled = container.querySelectorAll('.expr-enabled');
  const existing = model.model().expressions || [];
  const edits = [];
  names.forEach((nameInput, index) => {
    const name = nameInput.value.trim();
    if (!name) return;
    edits.push({
      name,
      file: (existing[index] || {}).file || '',
      durationSeconds: durations[index] ? durations[index].value : '',
      enabled: enabled[index] ? enabled[index].checked : false
    });
  });
  return edits;
}

//// 从动作列表 DOM 收集名字、分组、下标、时长、启用 [@busybee 2026-06-13] ////
function collectMotionEdits(doc) {
  const container = doc.getElementById('motion-list');
  const names = container.querySelectorAll('.motion-name');
  const groups = container.querySelectorAll('.motion-group');
  const indices = container.querySelectorAll('.motion-index');
  const durations = container.querySelectorAll('.motion-dur');
  const enabled = container.querySelectorAll('.motion-enabled');
  const edits = [];
  names.forEach((nameInput, index) => {
    const name = nameInput.value.trim();
    if (!name) return;
    edits.push({
      name,
      group: groups[index] ? groups[index].value : 'Default',
      index: parseInt(indices[index] ? indices[index].value : 0) || 0,
      durationSeconds: durations[index] ? durations[index].value : '',
      enabled: enabled[index] ? enabled[index].checked : false
    });
  });
  return edits;
}

module.exports = { mountEmotionPanel, renderExpressionList, renderMotionList };
