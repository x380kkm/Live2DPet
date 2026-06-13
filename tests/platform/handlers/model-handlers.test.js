// 运行: node --test tests/platform/handlers/model-handlers.test.js
// 用内存假件注入 picker、files 文件系统窄接口、config 与 paths,断言模型文件夹定位与下探、
// model3.json 扫描汇总、参数映射建议、文件选择与复制、路径校验与外观档删除。

const { test } = require('node:test');
const assert = require('node:assert');
const {
  createModelHandlers, suggestParamMapping, PARAM_FUZZY_MAP
} = require('../../../src/platform/ipc/handlers/model-handlers');

//// 内存文件系统:dirs 列目录、jsons 给 readJson、存在性据二者键判定 [@busybee 2026-06-13] ////
function fakeFiles(opts = {}) {
  const dirs = opts.dirs || {};
  const jsons = opts.jsons || {};
  const present = new Set(opts.present || []);
  Object.keys(jsons).forEach((p) => present.add(p));
  const copies = [];
  const removed = [];
  return {
    dirs, jsons, present, copies, removed,
    join: (...parts) => parts.join('/'),
    extname: (p) => { const i = p.lastIndexOf('.'); return i < 0 ? '' : p.slice(i); },
    basename: (p) => p.split('/').pop(),
    async listDir(dir) { return dirs[dir] || []; },
    async readJson(p) {
      if (!(p in jsons)) { const e = new Error('ENOENT'); e.code = 'ENOENT'; throw e; }
      if (jsons[p] === '__BAD__') throw new Error('bad json');
      return JSON.parse(JSON.stringify(jsons[p]));
    },
    async exists(p) { return present.has(p) || p in dirs; },
    async isDirectory(p) { return p in dirs; },
    async copyFile(src, dest) { copies.push({ src, dest, kind: 'file' }); present.add(dest); },
    async copyDir(src, dest) { copies.push({ src, dest, kind: 'dir' }); present.add(dest); },
    async removeDir(p) { removed.push(p); present.delete(p); }
  };
}

//// 内存选择框:按脚本逐次返回 { canceled, paths } [@busybee 2026-06-13] ////
function fakePicker(script = {}) {
  return {
    async pickDirectory() { return script.directory || { canceled: true, paths: [] }; },
    async pickFile() { return script.file || { canceled: true, paths: [] }; }
  };
}

//// 造一套处理器,逐项覆盖注入件;mt 透传键名便于断言 [@busybee 2026-06-13] ////
function makeHandlers(overrides = {}) {
  const deps = {
    picker: overrides.picker || fakePicker(),
    files: overrides.files || fakeFiles(),
    config: overrides.config || { async read() { return {}; } },
    paths: overrides.paths || { userDataDir: () => '/userdata' },
    mt: overrides.mt || ((k) => k)
  };
  return { handlers: createModelHandlers(deps), deps };
}

test('suggestParamMapping 大小写不敏感匹配,无候选填 null', () => {
  const mapping = suggestParamMapping(['paramanglex', 'ParamEyeBallY']);
  assert.strictEqual(mapping.angleX, 'paramanglex');
  assert.strictEqual(mapping.eyeBallY, 'ParamEyeBallY');
  assert.strictEqual(mapping.angleZ, null);
  assert.deepStrictEqual(Object.keys(mapping), Object.keys(PARAM_FUZZY_MAP));
});

test('select-model-folder 取消时报 cancelled', async () => {
  const { handlers } = makeHandlers();
  assert.match((await handlers['select-model-folder']()).error, /cancelled/);
});

test('select-model-folder 本层含 model3.json 时直接选中', async () => {
  const files = fakeFiles({ dirs: { '/m': ['hiyori.model3.json', 'tex.png'] } });
  const picker = fakePicker({ directory: { canceled: false, paths: ['/m'] } });
  const { handlers } = makeHandlers({ files, picker });
  const result = await handlers['select-model-folder']();
  assert.strictEqual(result.success, true);
  assert.strictEqual(result.folderPath, '/m');
  assert.deepStrictEqual(result.modelFiles, ['hiyori.model3.json']);
});

test('select-model-folder 下探一层子目录定位 model3.json', async () => {
  const files = fakeFiles({ dirs: {
    '/m': ['runtime'],
    '/m/runtime': ['hiyori.model3.json']
  } });
  const picker = fakePicker({ directory: { canceled: false, paths: ['/m'] } });
  const { handlers } = makeHandlers({ files, picker });
  const result = await handlers['select-model-folder']();
  assert.strictEqual(result.folderPath, '/m/runtime');
  assert.deepStrictEqual(result.modelFiles, ['hiyori.model3.json']);
});

test('select-model-folder 无 model3.json 时报 noModel3Json', async () => {
  const files = fakeFiles({ dirs: { '/m': ['readme.txt'] } });
  const picker = fakePicker({ directory: { canceled: false, paths: ['/m'] } });
  const { handlers } = makeHandlers({ files, picker });
  assert.strictEqual((await handlers['select-model-folder']()).error, 'main.noModel3Json');
});

test('scan-model-info 汇总参数、表情、动作与校验,并给映射建议', async () => {
  const modelJson = {
    Groups: [{ Ids: ['ParamAngleX', 'ParamAngleY'] }],
    HitAreas: [{ Id: 'Head' }],
    FileReferences: {
      Moc: 'm.moc3',
      Textures: ['t.png'],
      DisplayInfo: 'm.cdi3.json',
      Expressions: [{ Name: 'smile', File: 's.exp3.json' }],
      Motions: { Idle: [{ File: 'i.motion3.json' }] }
    }
  };
  const files = fakeFiles({
    jsons: {
      '/m/m.model3.json': modelJson,
      '/m/m.cdi3.json': { Parameters: [{ Id: 'ParamEyeBallX' }] }
    },
    present: ['/m/m.moc3', '/m/t.png']
  });
  const { handlers } = makeHandlers({ files });
  const result = await handlers['scan-model-info'](['/m', 'm.model3.json']);
  assert.strictEqual(result.success, true);
  assert.strictEqual(result.modelName, 'm');
  assert.deepStrictEqual(result.parameterIds, ['ParamAngleX', 'ParamAngleY', 'ParamEyeBallX']);
  assert.strictEqual(result.suggestedMapping.angleX, 'ParamAngleX');
  assert.strictEqual(result.suggestedMapping.eyeBallX, 'ParamEyeBallX');
  assert.deepStrictEqual(result.expressions, [{ name: 'smile', file: 's.exp3.json' }]);
  assert.deepStrictEqual(result.motions, { Idle: [{ file: 'i.motion3.json' }] });
  assert.deepStrictEqual(result.validation, { mocValid: true, texturesValid: true });
});

test('scan-model-info 无声明时回退扫目录里的 exp3/motion3 文件', async () => {
  const files = fakeFiles({
    jsons: { '/m/m.model3.json': { FileReferences: {} } },
    dirs: { '/m': ['joy.exp3.json', 'walk.motion3.json'] }
  });
  const { handlers } = makeHandlers({ files });
  const result = await handlers['scan-model-info'](['/m', 'm.model3.json']);
  assert.deepStrictEqual(result.expressions, [{ name: 'joy', file: 'joy.exp3.json' }]);
  assert.deepStrictEqual(result.motions, { Default: [{ file: 'walk.motion3.json' }] });
});

test('scan-model-info model3.json 不存在时报 model3NotExist', async () => {
  const { handlers } = makeHandlers();
  assert.strictEqual((await handlers['scan-model-info'](['/m', 'gone.model3.json'])).error, 'main.model3NotExist');
});

test('scan-image-folder 只列受支持扩展名的图片', async () => {
  const files = fakeFiles({ dirs: { '/imgs': ['a.PNG', 'b.gif', 'c.jpeg', 'd.txt'] } });
  const { handlers } = makeHandlers({ files });
  const result = await handlers['scan-image-folder']('/imgs');
  assert.deepStrictEqual(result.images.map((i) => i.filename), ['a.PNG', 'c.jpeg']);
  assert.strictEqual(result.images[0].path, '/imgs/a.PNG');
});

test('select-app-icon 复制图标进用户数据目录', async () => {
  const files = fakeFiles();
  const picker = fakePicker({ file: { canceled: false, paths: ['/src/icon.ico'] } });
  const { handlers } = makeHandlers({ files, picker });
  const result = await handlers['select-app-icon']();
  assert.strictEqual(result.iconPath, '/userdata/app-icon.ico');
  assert.deepStrictEqual(files.copies[0], { src: '/src/icon.ico', dest: '/userdata/app-icon.ico', kind: 'file' });
});

test('copy-model-to-userdata 递归复制到 models 下并返回相对绝对路径', async () => {
  const files = fakeFiles();
  const { handlers } = makeHandlers({ files });
  const result = await handlers['copy-model-to-userdata'](['/src/hiyori', 'Hiyori']);
  assert.strictEqual(result.userDataModelPath, 'models/Hiyori');
  assert.strictEqual(result.absolutePath, '/userdata/models/Hiyori');
  assert.deepStrictEqual(files.copies[0], { src: '/src/hiyori', dest: '/userdata/models/Hiyori', kind: 'dir' });
});

test('validate-model-paths type none 直接有效', async () => {
  const config = { async read() { return { model: { type: 'none' } }; } };
  const { handlers } = makeHandlers({ config });
  assert.deepStrictEqual(await handlers['validate-model-paths'](), { success: true, valid: true, type: 'none' });
});

test('validate-model-paths live2d 目录缺失时无效', async () => {
  const config = { async read() { return { model: { type: 'live2d', folderPath: '/gone' } }; } };
  const { handlers } = makeHandlers({ config, files: fakeFiles() });
  const result = await handlers['validate-model-paths']();
  assert.strictEqual(result.valid, false);
  assert.strictEqual(result.error, 'main.modelFolderNotExist');
});

test('validate-model-paths live2d 经 userDataModelPath 拼目录并校验 json', async () => {
  const files = fakeFiles({
    present: ['/userdata/models/Hiyori'],
    jsons: { '/userdata/models/Hiyori/h.model3.json': { ok: true } }
  });
  const config = { async read() { return { model: { type: 'live2d', userDataModelPath: 'models/Hiyori', modelJsonFile: 'h.model3.json' } }; } };
  const { handlers } = makeHandlers({ files, config });
  const result = await handlers['validate-model-paths']();
  assert.strictEqual(result.valid, true);
  assert.strictEqual(result.modelDir, '/userdata/models/Hiyori');
});

test('validate-model-paths image 缺图时无效', async () => {
  const config = { async read() { return { model: { type: 'image', staticImagePath: '/gone.png' } }; } };
  const { handlers } = makeHandlers({ config, files: fakeFiles() });
  assert.strictEqual((await handlers['validate-model-paths']()).valid, false);
});

test('delete-profile 校验 id 并递归删目录', async () => {
  const id = '77777777-7777-4777-8777-777777777777';
  const files = fakeFiles({ present: [`/userdata/profiles/${id}`] });
  const { handlers } = makeHandlers({ files });
  assert.match((await handlers['delete-profile']('bad')).error, /invalid profile ID/);
  const result = await handlers['delete-profile'](id);
  assert.strictEqual(result.success, true);
  assert.deepStrictEqual(files.removed, [`/userdata/profiles/${id}`]);
});
