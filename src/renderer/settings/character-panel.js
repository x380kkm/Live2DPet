// audience: internal
// # character-panel
// 角色卡标签页子面板:角色卡选择、增删改导入、重置内置、字段编辑与保存。
// 不变量:当前角色 id 与字段值是面板内状态;切换角色与语言时经回调通知组合根重载 prompt。

// 角色卡字段到表单输入 id 的固定映射,决定填充与收集的范围。
const FIELD_IDS = {
  name: 'prompt-name',
  userIdentity: 'prompt-user-identity',
  userTerm: 'prompt-user-term',
  description: 'prompt-desc',
  personality: 'prompt-personality',
  scenario: 'prompt-scenario',
  rules: 'prompt-rules',
  language: 'prompt-language'
};

// 命中动作字段到表单输入 id 的固定映射。
const HIT_IDS = {
  click: 'prompt-hit-click',
  touch: 'prompt-hit-touch',
  drag: 'prompt-hit-drag',
  swipe: 'prompt-hit-swipe',
  resize: 'prompt-hit-resize'
};

//// 装配角色卡面板,持有当前角色 id 与新建改名的输入状态 [@busybee 2026-06-13] ////
function mountCharacterPanel(ctx) {
  const { doc, gateway, t, showStatus } = ctx;
  const state = { currentId: null, nameAction: null };

  doc.getElementById('character-select').addEventListener('change', async (e) => {
    const id = e.target.value;
    await gateway.character.setActive(id);
    state.currentId = id;
    await loadPrompt(ctx, id);
    if (ctx.onCharacterChanged) await ctx.onCharacterChanged(id);
    showStatus('prompt-status', t('status.switched'), 'success');
  });

  doc.getElementById('btn-new-character').addEventListener('click', () => showNameInput(ctx, state, '', 'new'));
  doc.getElementById('btn-rename-character').addEventListener('click', () => {
    if (!state.currentId) return;
    const select = doc.getElementById('character-select');
    const currentName = (select.options[select.selectedIndex] || {}).textContent || '';
    showNameInput(ctx, state, currentName, 'rename');
  });
  doc.getElementById('btn-cancel-name').addEventListener('click', () => hideNameInput(ctx, state));
  doc.getElementById('btn-confirm-name').addEventListener('click', () => confirmName(ctx, state));
  doc.getElementById('character-name-input').addEventListener('keydown', (e) => {
    if (e.key === 'Enter') doc.getElementById('btn-confirm-name').click();
    if (e.key === 'Escape') hideNameInput(ctx, state);
  });

  doc.getElementById('btn-import-character').addEventListener('click', () => importCharacter(ctx, state));
  doc.getElementById('btn-delete-character').addEventListener('click', () => deleteCharacter(ctx, state));
  doc.getElementById('btn-reset-builtin').addEventListener('click', () => resetBuiltin(ctx, state));
  doc.getElementById('btn-save-prompt').addEventListener('click', () => savePrompt(ctx, state));

  // 把面板内状态交给组合根,使语言切换可重载角色卡。
  ctx.characterState = state;
  ctx.reloadCharacterList = () => loadCharacterList(ctx, state);
  ctx.reloadCharacterPrompt = () => loadPrompt(ctx, state.currentId);
}

//// 拉取角色卡列表填入下拉并载入当前角色字段 [@busybee 2026-06-13] ////
async function loadCharacterList(ctx, state) {
  const { doc, gateway, t } = ctx;
  if (!gateway.character.list) return;
  const { characters, activeCharacterId } = await gateway.character.list();
  const select = doc.getElementById('character-select');
  select.innerHTML = '';
  for (const character of characters) {
    const option = doc.createElement('option');
    option.value = character.id;
    option.textContent = character.builtin ? `${character.name} ${t('card.builtin')}` : character.name;
    select.appendChild(option);
  }
  select.value = activeCharacterId;
  state.currentId = activeCharacterId;
  await loadPrompt(ctx, activeCharacterId);
}

//// 载入一个角色卡的字段,内置卡按当前语言解析 i18n 覆盖 [@busybee 2026-06-13] ////
async function loadPrompt(ctx, id) {
  const { gateway, lang } = ctx;
  if (!gateway.character.loadPrompt || !id) return;
  const result = await gateway.character.loadPrompt(id);
  if (!result.success) return;
  ctx.characterState.currentId = result.id || id;
  const data = { ...result.data };
  if (result.i18n && lang() && result.i18n[lang()]) {
    Object.assign(data, result.i18n[lang()]);
  }
  fillFields(ctx, data);
}

//// 把角色卡数据填入各表单输入 [@busybee 2026-06-13] ////
function fillFields(ctx, data) {
  const { doc } = ctx;
  for (const [field, id] of Object.entries(FIELD_IDS)) {
    doc.getElementById(id).value = data[field] || '';
  }
  const hitActions = data.hitActions || {};
  for (const [action, id] of Object.entries(HIT_IDS)) {
    doc.getElementById(id).value = hitActions[action] || '';
  }
}

//// 从各表单输入收集角色卡数据 [@busybee 2026-06-13] ////
function collectFields(ctx) {
  const { doc } = ctx;
  const data = {};
  for (const [field, id] of Object.entries(FIELD_IDS)) {
    data[field] = doc.getElementById(id).value;
  }
  data.hitActions = {};
  for (const [action, id] of Object.entries(HIT_IDS)) {
    data.hitActions[action] = doc.getElementById(id).value.trim();
  }
  return data;
}

//// 展开内联名字输入行并记录本次动作是新建还是改名 [@busybee 2026-06-13] ////
function showNameInput(ctx, state, defaultValue, action) {
  const { doc } = ctx;
  state.nameAction = action;
  const row = doc.getElementById('character-name-input-row');
  const input = doc.getElementById('character-name-input');
  input.value = defaultValue || '';
  row.style.display = 'flex';
  input.focus();
  input.select();
}

//// 收起内联名字输入行并清空动作 [@busybee 2026-06-13] ////
function hideNameInput(ctx, state) {
  ctx.doc.getElementById('character-name-input-row').style.display = 'none';
  state.nameAction = null;
}

//// 按当前动作确认名字:新建则创建并激活,改名则改当前角色名 [@busybee 2026-06-13] ////
async function confirmName(ctx, state) {
  const { doc, gateway, t, showStatus } = ctx;
  const name = doc.getElementById('character-name-input').value.trim();
  if (!name) return;
  if (state.nameAction === 'new') {
    const result = await gateway.character.create(name);
    if (result.success) {
      await gateway.character.setActive(result.id);
      await loadCharacterList(ctx, state);
      showStatus('prompt-status', t('status.created') + name, 'success');
    }
  } else if (state.nameAction === 'rename' && state.currentId) {
    const result = await gateway.character.rename(state.currentId, name);
    if (result.success) {
      await loadCharacterList(ctx, state);
      showStatus('prompt-status', t('status.renamed'), 'success');
    }
  }
  hideNameInput(ctx, state);
}

//// 导入角色卡并激活最后一张 [@busybee 2026-06-13] ////
async function importCharacter(ctx, state) {
  const { gateway, t, showStatus } = ctx;
  const result = await gateway.character.import();
  if (result.success && result.imported.length > 0) {
    const last = result.imported[result.imported.length - 1];
    await gateway.character.setActive(last.id);
    await loadCharacterList(ctx, state);
    showStatus('prompt-status', t('status.created') + last.name, 'success');
  }
}

//// 删除当前角色卡并重载列表与 prompt [@busybee 2026-06-13] ////
async function deleteCharacter(ctx, state) {
  const { gateway, t, showStatus } = ctx;
  if (!state.currentId) return;
  const result = await gateway.character.remove(state.currentId);
  if (result.success) {
    await loadCharacterList(ctx, state);
    if (ctx.onCharacterChanged) await ctx.onCharacterChanged(state.currentId);
    showStatus('prompt-status', t('status.deleted'), 'success');
  } else {
    showStatus('prompt-status', result.error, 'error');
  }
}

//// 重置内置角色卡并重载 [@busybee 2026-06-13] ////
async function resetBuiltin(ctx, state) {
  const { gateway, t, showStatus } = ctx;
  if (!gateway.character.resetBuiltin) return;
  const result = await gateway.character.resetBuiltin();
  if (result.success) {
    await loadCharacterList(ctx, state);
    await loadPrompt(ctx, state.currentId);
    if (ctx.onCharacterChanged) await ctx.onCharacterChanged(state.currentId);
    showStatus('prompt-status', t('status.builtinReset'), 'success');
  }
}

//// 收集字段保存当前角色卡并通知重载宠物 prompt [@busybee 2026-06-13] ////
async function savePrompt(ctx, state) {
  const { gateway, t, showStatus } = ctx;
  if (!state.currentId) return;
  const result = await gateway.character.savePrompt(state.currentId, collectFields(ctx));
  if (result.success) {
    showStatus('prompt-status', t('status.saved'), 'success');
    if (ctx.onCharacterChanged) await ctx.onCharacterChanged(state.currentId);
  } else {
    showStatus('prompt-status', t('status.saveFail') + result.error, 'error');
  }
}

module.exports = { mountCharacterPanel, loadCharacterList };
