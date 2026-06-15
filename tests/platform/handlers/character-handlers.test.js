// 运行: node --test tests/platform/handlers/character-handlers.test.js
// 用内存假件注入 cardStore、config 花名册、bundled 内置卡源,断言角色卡的增删改查、
// 导入、迁移与内置卡刷新行为,以及处理器表对 ipc-router 多参 payload 约定的解包。

const { test } = require('node:test');
const assert = require('node:assert');
const {
  createCharacterHandlers, readCardInfo, looksLikeCard, DEFAULT_CHARACTER_ID
} = require('../../../src/platform/ipc/handlers/character-handlers');

//// 内存卡存储:id 映射到卡对象,记录读写删 [@x380kkm 2026-06-13] ////
function fakeCardStore(initial = {}) {
  const cards = { ...initial };
  return {
    cards,
    async get(id) { return id in cards ? JSON.parse(JSON.stringify(cards[id])) : null; },
    async put(id, data) { cards[id] = JSON.parse(JSON.stringify(data)); },
    async remove(id) { delete cards[id]; },
    async exists(id) { return id in cards; },
    async listIds() { return Object.keys(cards); }
  };
}

//// 内存花名册:read 返回当前快照,write 浅合并补丁 [@x380kkm 2026-06-13] ////
function fakeConfig(initial = {}) {
  let roster = { ...initial };
  return {
    snapshot: () => roster,
    async read() { return JSON.parse(JSON.stringify(roster)); },
    async write(patch) { roster = { ...roster, ...patch }; }
  };
}

//// 内存内置卡源:可配是否打包态、版本与卡内容 [@x380kkm 2026-06-13] ////
function fakeBundled(opts = {}) {
  const state = {
    packaged: opts.packaged || false,
    current: opts.current || 'v1',
    version: opts.version || '',
    cards: opts.cards || {}
  };
  return {
    state,
    async isPackaged() { return state.packaged; },
    async currentVersion() { return state.current; },
    async readVersion() { return state.version; },
    async writeVersion(v) { state.version = v; },
    async listNames() { return Object.keys(state.cards).map((id) => `${id}.json`); },
    async read(name) { return JSON.parse(JSON.stringify(state.cards[name.replace('.json', '')])); }
  };
}

//// 造一套处理器,允许逐项覆盖注入件 [@x380kkm 2026-06-13] ////
function makeHandlers(overrides = {}) {
  let counter = 0;
  const deps = {
    cardStore: overrides.cardStore || fakeCardStore(),
    config: overrides.config || fakeConfig(),
    bundled: overrides.bundled || fakeBundled(),
    newId: overrides.newId || (() => `00000000-0000-4000-8000-00000000000${counter++}`),
    chooseFiles: overrides.chooseFiles || (async () => [])
  };
  return { handlers: createCharacterHandlers(deps), deps };
}

const VALID_ID = '11111111-2222-4333-8444-555555555555';

test('readCardInfo 取展示名与内置标记,空卡回退到 id', () => {
  assert.deepStrictEqual(readCardInfo({ data: { cardName: 'Alice' }, builtin: true }, 'x'),
    { name: 'Alice', builtin: true });
  assert.deepStrictEqual(readCardInfo(null, 'fallback'), { name: 'fallback', builtin: false });
});

test('looksLikeCard 据 data/name/cardName 任一判定', () => {
  assert.strictEqual(looksLikeCard({ data: {} }), true);
  assert.strictEqual(looksLikeCard({ name: 'x' }), true);
  assert.strictEqual(looksLikeCard({ other: 1 }), false);
  assert.strictEqual(looksLikeCard(null), false);
});

test('list-characters 首启迁移建默认花名册', async () => {
  const { handlers, deps } = makeHandlers();
  const result = await handlers['list-characters']();
  assert.strictEqual(result.activeCharacterId, DEFAULT_CHARACTER_ID);
  assert.deepStrictEqual(deps.config.snapshot().characters, [{ id: DEFAULT_CHARACTER_ID }]);
});

test('list-characters 自动补登未登记的磁盘卡', async () => {
  const cardStore = fakeCardStore({ [VALID_ID]: { data: { cardName: 'Loose' } } });
  const config = fakeConfig({ characters: [{ id: DEFAULT_CHARACTER_ID }], activeCharacterId: DEFAULT_CHARACTER_ID });
  const { handlers } = makeHandlers({ cardStore, config });
  const result = await handlers['list-characters']();
  const ids = result.characters.map((c) => c.id);
  assert.ok(ids.includes(VALID_ID));
  assert.strictEqual(result.characters.find((c) => c.id === VALID_ID).name, 'Loose');
});

test('load-prompt 无 id 时取激活卡并返回其数据', async () => {
  const cardStore = fakeCardStore({ [VALID_ID]: { data: { name: 'Bob' }, builtin: true } });
  const config = fakeConfig({ characters: [{ id: VALID_ID }], activeCharacterId: VALID_ID });
  const { handlers } = makeHandlers({ cardStore, config });
  const result = await handlers['load-prompt'](null);
  assert.strictEqual(result.success, true);
  assert.deepStrictEqual(result.data, { name: 'Bob' });
  assert.strictEqual(result.builtin, true);
  assert.strictEqual(result.id, VALID_ID);
});

test('load-prompt 非法 id 与缺卡分别报错', async () => {
  const { handlers } = makeHandlers();
  assert.match((await handlers['load-prompt']('bad')).error, /invalid character ID/);
  assert.match((await handlers['load-prompt'](VALID_ID)).error, /not found/);
});

test('save-prompt 解包多参 payload 并保留 builtin 与 i18n', async () => {
  const cardStore = fakeCardStore({ [VALID_ID]: { data: { name: 'old' }, builtin: true, i18n: { zh: {} } } });
  const { handlers } = makeHandlers({ cardStore });
  const result = await handlers['save-prompt']([VALID_ID, { name: 'new' }]);
  assert.strictEqual(result.success, true);
  const saved = cardStore.cards[VALID_ID];
  assert.deepStrictEqual(saved.data, { name: 'new' });
  assert.strictEqual(saved.builtin, true);
  assert.deepStrictEqual(saved.i18n, { zh: {} });
});

test('create-character 建空白卡并登记进花名册', async () => {
  const config = fakeConfig({ characters: [{ id: DEFAULT_CHARACTER_ID }] });
  const { handlers, deps } = makeHandlers({ config });
  const result = await handlers['create-character']('Carol');
  assert.strictEqual(result.success, true);
  assert.strictEqual(result.name, 'Carol');
  assert.ok(deps.cardStore.cards[result.id]);
  assert.ok(config.snapshot().characters.some((c) => c.id === result.id));
});

test('import-character 取消时报 canceled,导入时剥 builtin 标记', async () => {
  const canceled = makeHandlers({ chooseFiles: async () => [] });
  assert.match((await canceled.handlers['import-character']()).error, /canceled/);

  const raw = JSON.stringify({ data: { cardName: 'Imp' }, builtin: true });
  const config = fakeConfig({ characters: [] });
  const { handlers, deps } = makeHandlers({ config, chooseFiles: async () => [raw] });
  const result = await handlers['import-character']();
  assert.strictEqual(result.success, true);
  assert.strictEqual(result.imported.length, 1);
  const id = result.imported[0].id;
  assert.strictEqual(deps.cardStore.cards[id].builtin, undefined);
});

test('delete-character 拒删最后一张,删激活卡时改激活', async () => {
  const idA = '11111111-1111-4111-8111-111111111111';
  const idB = '22222222-2222-4222-8222-222222222222';
  const single = makeHandlers({ config: fakeConfig({ characters: [{ id: idA }], activeCharacterId: idA }) });
  assert.match((await single.handlers['delete-character'](idA)).error, /cannot delete last/);

  const cardStore = fakeCardStore({ [idA]: { data: {} }, [idB]: { data: {} } });
  const config = fakeConfig({ characters: [{ id: idA }, { id: idB }], activeCharacterId: idA });
  const { handlers } = makeHandlers({ cardStore, config });
  const result = await handlers['delete-character'](idA);
  assert.strictEqual(result.success, true);
  assert.strictEqual(result.newActiveId, idB);
  assert.strictEqual(cardStore.cards[idA], undefined);
});

test('rename-character 改花名册条目展示名', async () => {
  const config = fakeConfig({ characters: [{ id: VALID_ID, name: 'old' }] });
  const { handlers } = makeHandlers({ config });
  await handlers['rename-character']([VALID_ID, 'fresh']);
  assert.strictEqual(config.snapshot().characters[0].name, 'fresh');
});

test('set-active-character 写激活 id,reset-prompt 报无默认', async () => {
  const config = fakeConfig({});
  const { handlers } = makeHandlers({ config });
  await handlers['set-active-character'](VALID_ID);
  assert.strictEqual(config.snapshot().activeCharacterId, VALID_ID);
  assert.match((await handlers['reset-prompt']()).error, /no default/);
});

test('reset-builtin-cards 把内置卡还原回出厂内容', async () => {
  const id = '33333333-3333-4333-8333-333333333333';
  const cardStore = fakeCardStore({ [id]: { data: { name: 'edited' } } });
  const bundled = fakeBundled({ cards: { [id]: { data: { name: 'factory' }, builtin: true } } });
  const { handlers } = makeHandlers({ cardStore, bundled });
  const result = await handlers['reset-builtin-cards']();
  assert.strictEqual(result.count, 1);
  assert.deepStrictEqual(cardStore.cards[id].data, { name: 'factory' });
});

test('migrateBundledCards 非打包态不动卡', async () => {
  const id = '44444444-4444-4444-8444-444444444444';
  const cardStore = fakeCardStore({ [id]: { data: { name: 'keep' } } });
  const bundled = fakeBundled({ packaged: false, cards: { [id]: { data: { name: 'new' }, builtin: true } } });
  const { handlers } = makeHandlers({ cardStore, bundled });
  await handlers.migrateBundledCards();
  assert.deepStrictEqual(cardStore.cards[id].data, { name: 'keep' });
});

test('migrateBundledCards 版本变更时刷新内置卡并克隆用户改动卡', async () => {
  const id = '55555555-5555-4555-8555-555555555555';
  // 用户改过内置卡:builtin 标记已去掉,迁移须先克隆再刷新。
  const cardStore = fakeCardStore({ [id]: { data: { name: 'mine' } } });
  const config = fakeConfig({ characters: [{ id }] });
  const bundled = fakeBundled({ packaged: true, current: 'v2', version: 'v1', cards: { [id]: { data: { name: 'factory' }, builtin: true } } });
  let n = 0;
  const newId = () => `66666666-6666-4666-8666-66666666666${n++}`;
  const { handlers } = makeHandlers({ cardStore, config, bundled, newId });
  await handlers.migrateBundledCards();
  assert.deepStrictEqual(cardStore.cards[id].data, { name: 'factory' });
  const cloneId = '66666666-6666-4666-8666-666666666660';
  assert.deepStrictEqual(cardStore.cards[cloneId].data, { name: 'mine' });
  assert.ok(config.snapshot().characters.some((c) => c.id === cloneId));
  assert.strictEqual(bundled.state.version, 'v2');
});
