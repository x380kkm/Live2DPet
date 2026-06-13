// audience: internal
// # character-handlers
// 角色卡的增删改查、导入与内置卡迁移,产出按通道名索引的处理器表供 ipc-router 注册。
// 迁移自 src/main/character-manager.js,去掉对全局 ctx 的依赖,文件存储改异步、经构造注入。
//
// 构造注入的协作者都只是窄接口,第三方类型(fs、dialog、crypto)留在装配处:
//   cardStore   角色卡文件存储,异步:get(id)/put(id,data)/remove(id)/exists(id)/listIds()
//   config      角色花名册读写,异步:read() 返回 { characters, activeCharacterId };write(patch)
//   bundled     内置卡来源,异步:listNames()/read(name)/readVersion()/writeVersion(v)/isPackaged()
//   newId       生成新角色卡 id
//   chooseFiles 弹文件选择框,异步,返回选中的 JSON 文本数组,取消时返回空数组
//
// 处理器形参 payload 沿用 ipc-router 约定:单参通道收到值本身,多参通道收到参数数组。
// 默认角色卡 id 为内置卡固定 id,首次启动无花名册时据它建默认条目。

const { isValidUUID } = require('../../../main/validators');

//// 内置默认角色卡的固定 id,首启迁移据它建默认花名册 [@busybee 2026-06-13] ////
const DEFAULT_CHARACTER_ID = '2bcf3d8a-85e8-47dd-aa07-792fe91cca26';

//// 从一份角色卡 JSON 里取展示名与内置标记,解析失败回退到 id [@busybee 2026-06-13] ////
function readCardInfo(card, id) {
  if (!card) return { name: id, builtin: false };
  const d = card.data || card;
  return { name: d.cardName || d.name || id, builtin: !!card.builtin };
}

//// 判断一份 JSON 是否像一张角色卡:带 data、name 或 cardName 任一即认 [@busybee 2026-06-13] ////
function looksLikeCard(card) {
  if (!card || typeof card !== 'object') return false;
  return !!(card.data || card.name || card.cardName);
}

//// 装配角色卡处理器:取注入的窄接口,返回按通道名索引的处理器表 [@busybee 2026-06-13] ////
function createCharacterHandlers(deps) {
  const { cardStore, config, bundled, newId, chooseFiles } = deps;

  //// 首启迁移:花名册为空时建一条默认内置卡条目 [@busybee 2026-06-13] ////
  async function ensureDefaultCharacters() {
    const roster = await config.read();
    if (roster && roster.characters && roster.characters.length > 0) return;
    await config.write({
      characters: [{ id: DEFAULT_CHARACTER_ID }],
      activeCharacterId: DEFAULT_CHARACTER_ID
    });
  }

  //// 把磁盘上有卡文件却未登记进花名册的卡自动补登 [@busybee 2026-06-13] ////
  async function syncUnlinkedCards() {
    const roster = await config.read();
    const known = new Set(((roster && roster.characters) || []).map((c) => c.id));
    const ids = await cardStore.listIds();
    const added = [];
    for (const id of ids) {
      if (known.has(id)) continue;
      const card = await cardStore.get(id);
      if (looksLikeCard(card)) added.push({ id });
    }
    if (added.length > 0) {
      const characters = [...((roster && roster.characters) || []), ...added];
      await config.write({ characters });
    }
  }

  //// 内置卡迁移:版本变更时刷新内置卡,用户改过的卡先克隆保留 [@busybee 2026-06-13] ////
  async function migrateBundledCards() {
    if (!(await bundled.isPackaged())) return;
    const currentVersion = await bundled.currentVersion();
    const lastVersion = await bundled.readVersion();
    if (lastVersion === currentVersion) return;

    const names = await bundled.listNames();
    const clonedIds = [];
    for (const name of names) {
      const id = name.replace('.json', '');
      const existing = await cardStore.get(id);
      // 用户改过内置卡(保存时去掉了 builtin 标记)则先克隆成新卡,保住其改动。
      if (existing && !existing.builtin) {
        const cloneId = newId();
        await cardStore.put(cloneId, existing);
        clonedIds.push(cloneId);
      }
      await cardStore.put(id, await bundled.read(name));
    }
    if (clonedIds.length > 0) {
      const roster = await config.read();
      const characters = [...((roster && roster.characters) || []), ...clonedIds.map((id) => ({ id }))];
      await config.write({ characters });
    }
    await bundled.writeVersion(currentVersion);
  }

  //// 列花名册:先做首启与补登迁移,再附上每张卡的展示名与内置标记 [@busybee 2026-06-13] ////
  async function listCharacters() {
    await ensureDefaultCharacters();
    await syncUnlinkedCards();
    const roster = await config.read();
    const entries = (roster && roster.characters) || [];
    const characters = [];
    for (const c of entries) {
      const info = readCardInfo(await cardStore.get(c.id), c.id);
      characters.push({ id: c.id, name: info.name, builtin: info.builtin });
    }
    return { characters, activeCharacterId: (roster && roster.activeCharacterId) || '' };
  }

  //// 读一张卡的提示词:缺 id 时取当前激活卡 [@busybee 2026-06-13] ////
  async function loadPrompt(id) {
    if (!id) {
      const roster = await config.read();
      id = roster && roster.activeCharacterId;
    }
    if (!isValidUUID(id)) return { success: false, error: 'invalid character ID' };
    const card = await cardStore.get(id);
    if (!card) return { success: false, error: 'not found' };
    return { success: true, data: card.data || card, i18n: card.i18n || null, builtin: !!card.builtin, id };
  }

  //// 存一张卡的提示词:保留原文件里的 builtin 与 i18n 字段 [@busybee 2026-06-13] ////
  async function savePrompt(id, promptData) {
    if (!isValidUUID(id)) return { success: false, error: 'invalid character ID' };
    const json = { data: promptData };
    const existing = await cardStore.get(id);
    if (existing) {
      if (existing.builtin) json.builtin = true;
      if (existing.i18n) json.i18n = existing.i18n;
    }
    await cardStore.put(id, json);
    return { success: true };
  }

  //// 把内置卡全部还原回出厂内容 [@busybee 2026-06-13] ////
  async function resetBuiltinCards() {
    const names = await bundled.listNames();
    let count = 0;
    for (const name of names) {
      const id = name.replace('.json', '');
      await cardStore.put(id, await bundled.read(name));
      count++;
    }
    return { success: true, count };
  }

  //// 建一张空白卡并登记进花名册 [@busybee 2026-06-13] ////
  async function createCharacter(name) {
    const id = newId();
    const cardName = name || 'New Character';
    const blank = {
      data: {
        cardName, name: cardName,
        userIdentity: '', userTerm: '', description: '',
        personality: '', scenario: '', rules: '', language: ''
      }
    };
    await cardStore.put(id, blank);
    const roster = await config.read();
    const characters = [...((roster && roster.characters) || []), { id }];
    await config.write({ characters });
    return { success: true, id, name: cardName };
  }

  //// 从文件导入一或多张卡:逐张校验、剥掉 builtin 标记、登记进花名册 [@busybee 2026-06-13] ////
  async function importCharacter() {
    const picked = await chooseFiles();
    if (!picked || picked.length === 0) return { success: false, error: 'canceled' };
    const roster = await config.read();
    const characters = [...((roster && roster.characters) || [])];
    const imported = [];
    for (const raw of picked) {
      let card;
      try { card = JSON.parse(raw); } catch { continue; }
      if (!looksLikeCard(card)) continue;
      const id = newId();
      delete card.builtin;
      await cardStore.put(id, card);
      characters.push({ id });
      const d = card.data || card;
      imported.push({ id, name: d.cardName || d.name || id });
    }
    if (imported.length > 0) await config.write({ characters });
    return { success: true, imported };
  }

  //// 删一张卡:不许删到只剩一张,激活卡被删时改激活到剩下的第一张 [@busybee 2026-06-13] ////
  async function deleteCharacter(id) {
    if (!isValidUUID(id)) return { success: false, error: 'invalid character ID' };
    const roster = await config.read();
    const characters = (roster && roster.characters) || [];
    if (characters.length <= 1) return { success: false, error: 'cannot delete last character' };
    const filtered = characters.filter((c) => c.id !== id);
    const patch = { characters: filtered };
    if (roster.activeCharacterId === id) patch.activeCharacterId = filtered[0].id;
    await config.write(patch);
    await cardStore.remove(id);
    return { success: true, newActiveId: patch.activeCharacterId || roster.activeCharacterId };
  }

  //// 改一张卡在花名册里的展示名 [@busybee 2026-06-13] ////
  async function renameCharacter(id, newName) {
    if (!isValidUUID(id)) return { success: false, error: 'invalid character ID' };
    const roster = await config.read();
    const characters = ((roster && roster.characters) || []).map((c) =>
      c.id === id ? { ...c, name: newName } : c
    );
    await config.write({ characters });
    return { success: true };
  }

  //// 把某张卡设为当前激活卡 [@busybee 2026-06-13] ////
  async function setActiveCharacter(id) {
    if (!isValidUUID(id)) return { success: false, error: 'invalid character ID' };
    await config.write({ activeCharacterId: id });
    return { success: true };
  }

  //// 重置提示词:暂无逐卡默认值可还原 [@busybee 2026-06-13] ////
  async function resetPrompt() {
    return { success: false, error: 'no default available' };
  }

  return {
    'list-characters': () => listCharacters(),
    'load-prompt': (payload) => loadPrompt(payload),
    'save-prompt': (payload) => savePrompt(payload[0], payload[1]),
    'reset-prompt': () => resetPrompt(),
    'create-character': (payload) => createCharacter(payload),
    'import-character': () => importCharacter(),
    'delete-character': (payload) => deleteCharacter(payload),
    'rename-character': (payload) => renameCharacter(payload[0], payload[1]),
    'set-active-character': (payload) => setActiveCharacter(payload),
    'reset-builtin-cards': () => resetBuiltinCards(),
    migrateBundledCards
  };
}

module.exports = { createCharacterHandlers, readCardInfo, looksLikeCard, DEFAULT_CHARACTER_ID };
