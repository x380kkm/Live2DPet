// audience: internal
// # settings-model.test
// 验证设置面板配置数据模型与纯转换的行为契约:排序、时长换算、合并、扫描映射、VVM 与样式解析。

const { test } = require('node:test');
const assert = require('node:assert');

// settings-model 是 ESM(渲染侧),用动态 import 载入;各用例按需取出所需导出。
const loadModel = () => import('../../src/renderer/settings/settings-model.js');

test('sortParamCandidates 把建议项排到首位其余按字母序', async () => {
  const { sortParamCandidates } = await loadModel();
  const sorted = sortParamCandidates(['ParamC', 'ParamA', 'ParamB'], 'ParamC');
  assert.deepStrictEqual(sorted, ['ParamC', 'ParamA', 'ParamB']);
});

test('sortParamCandidates 无建议项时纯字母序', async () => {
  const { sortParamCandidates } = await loadModel();
  const sorted = sortParamCandidates(['z', 'a', 'm'], null);
  assert.deepStrictEqual(sorted, ['a', 'm', 'z']);
});

test('sortParamCandidates 不改动传入数组', async () => {
  const { sortParamCandidates } = await loadModel();
  const input = ['b', 'a'];
  sortParamCandidates(input, null);
  assert.deepStrictEqual(input, ['b', 'a']);
});

test('secondsToMs 正数转毫秒整数', async () => {
  const { secondsToMs } = await loadModel();
  assert.strictEqual(secondsToMs('2.5'), 2500);
  assert.strictEqual(secondsToMs(3), 3000);
});

test('secondsToMs 非正数与空值返回 null', async () => {
  const { secondsToMs } = await loadModel();
  assert.strictEqual(secondsToMs(0), null);
  assert.strictEqual(secondsToMs(-1), null);
  assert.strictEqual(secondsToMs(''), null);
  assert.strictEqual(secondsToMs('abc'), null);
});

test('msToSeconds 毫秒转秒,缺失给空串', async () => {
  const { msToSeconds } = await loadModel();
  assert.strictEqual(msToSeconds(2500), 2.5);
  assert.strictEqual(msToSeconds(0), '');
  assert.strictEqual(msToSeconds(undefined), '');
});

test('secondsToMsWithFallback 非正数落到兜底毫秒', async () => {
  const { secondsToMsWithFallback } = await loadModel();
  assert.strictEqual(secondsToMsWithFallback('5', 9999), 5000);
  assert.strictEqual(secondsToMsWithFallback('0', 5000), 5000);
  assert.strictEqual(secondsToMsWithFallback('', 3000), 3000);
});

test('mergeImageFiles 保留既有同名文件的分类开关', async () => {
  const { mergeImageFiles } = await loadModel();
  const existing = [{ file: 'a.png', idle: true, talking: false, emotionName: 'happy' }];
  const scanned = [{ filename: 'a.png' }, { filename: 'b.png' }];
  const merged = mergeImageFiles(existing, scanned);
  assert.deepStrictEqual(merged[0], { file: 'a.png', idle: true, talking: false, emotionName: 'happy' });
  assert.deepStrictEqual(merged[1], { file: 'b.png', idle: false, talking: false, emotionName: '' });
});

test('mergeImageFiles 既有列表为空时全部新建', async () => {
  const { mergeImageFiles } = await loadModel();
  const merged = mergeImageFiles(undefined, [{ filename: 'x.png' }]);
  assert.strictEqual(merged.length, 1);
  assert.strictEqual(merged[0].file, 'x.png');
  assert.strictEqual(merged[0].idle, false);
});

test('deriveExpressionsFromImageEmotions 按情绪名去重生成表情', async () => {
  const { deriveExpressionsFromImageEmotions } = await loadModel();
  const files = [
    { file: 'a.png', emotionName: 'happy' },
    { file: 'b.png', emotionName: 'happy' },
    { file: 'c.png', emotionName: 'sad' },
    { file: 'd.png', emotionName: '' }
  ];
  const expressions = deriveExpressionsFromImageEmotions(files);
  assert.deepStrictEqual(expressions, [
    { name: 'happy', label: 'happy', file: '' },
    { name: 'sad', label: 'sad', file: '' }
  ]);
});

test('expressionsFromScan 把扫描表情映射成配置项', async () => {
  const { expressionsFromScan } = await loadModel();
  const result = expressionsFromScan([{ name: 'smile', file: 'smile.exp3.json' }]);
  assert.deepStrictEqual(result, [{ name: 'smile', label: 'smile', file: 'smile.exp3.json' }]);
});

test('motionEmotionsFromScan 扁平分组动作并去路径去后缀作名', async () => {
  const { motionEmotionsFromScan } = await loadModel();
  const scanned = {
    Idle: [{ file: 'motions/idle_01.motion3.json' }, { file: 'idle_02.motion3.json' }],
    Tap: [{ file: 'tap.motion3.json' }]
  };
  const motions = motionEmotionsFromScan(scanned);
  assert.deepStrictEqual(motions, [
    { name: 'idle_01', group: 'Idle', index: 0 },
    { name: 'idle_02', group: 'Idle', index: 1 },
    { name: 'tap', group: 'Tap', index: 0 }
  ]);
});

test('motionEmotionsFromScan 文件名缺失时退回 组_下标', async () => {
  const { motionEmotionsFromScan } = await loadModel();
  const motions = motionEmotionsFromScan({ G: [{ file: '' }] });
  assert.strictEqual(motions[0].name, 'G_0');
});

test('availableVvmState 算出磁盘就绪、勾选与禁用三态', async () => {
  const { availableVvmState } = await loadModel();
  const states = availableVvmState(['0.vvm'], ['0.vvm', '1.vvm']);
  const zero = states.find((s) => s.file === '0.vvm');
  const one = states.find((s) => s.file === '1.vvm');
  assert.strictEqual(zero.onDisk, true);
  assert.strictEqual(zero.checked, true);
  assert.strictEqual(zero.disabled, false);
  // 1.vvm 已在载入列表但不在磁盘,不应勾选且禁用。
  assert.strictEqual(one.onDisk, false);
  assert.strictEqual(one.checked, false);
  assert.strictEqual(one.disabled, true);
});

test('resolveStyleSelection 在元数据里定位说话人与样式', async () => {
  const { resolveStyleSelection } = await loadModel();
  const metas = [
    { name: 'A', styles: [{ id: 0 }, { id: 1 }] },
    { name: 'B', styles: [{ id: 5 }] }
  ];
  assert.deepStrictEqual(resolveStyleSelection(metas, 5), { speakerIndex: 1, styleId: 5 });
  assert.deepStrictEqual(resolveStyleSelection(metas, 1), { speakerIndex: 0, styleId: 1 });
});

test('resolveStyleSelection 找不到样式时回退首位且样式为空', async () => {
  const { resolveStyleSelection } = await loadModel();
  const metas = [{ name: 'A', styles: [{ id: 0 }] }];
  assert.deepStrictEqual(resolveStyleSelection(metas, 99), { speakerIndex: 0, styleId: null });
});

test('tokenCountForMultiplier 以 2048 为基准', async () => {
  const { tokenCountForMultiplier } = await loadModel();
  assert.strictEqual(tokenCountForMultiplier(1), 2048);
  assert.strictEqual(tokenCountForMultiplier(2), 4096);
  assert.strictEqual(tokenCountForMultiplier(0.5), 1024);
});

test('SettingsModel 构造深拷贝快照不共享引用', async () => {
  const { SettingsModel } = await loadModel();
  const snapshot = { model: { type: 'live2d', expressions: [] } };
  const model = new SettingsModel(snapshot);
  model.model().type = 'image';
  assert.strictEqual(snapshot.model.type, 'live2d');
});

test('SettingsModel 缺 model 时补建为 none', async () => {
  const { SettingsModel } = await loadModel();
  const model = new SettingsModel({});
  assert.strictEqual(model.model().type, 'none');
});

test('applyScan 写入扫描结果并清空旧时长', async () => {
  const { SettingsModel } = await loadModel();
  const model = new SettingsModel({ model: { expressionDurations: { old: 1 } } });
  model.applyScan({
    parameterIds: ['P1', 'P2'],
    suggestedMapping: { angleX: 'P1' },
    expressions: [{ name: 'e1', file: 'e1.exp3.json' }],
    motions: { Idle: [{ file: 'idle.motion3.json' }] }
  });
  assert.strictEqual(model.model().type, 'live2d');
  assert.strictEqual(model.model().hasExpressions, true);
  assert.deepStrictEqual(model.model().expressionDurations, {});
  assert.strictEqual(model.model().expressions[0].name, 'e1');
  assert.strictEqual(model.model().motionEmotions[0].name, 'idle');
  assert.deepStrictEqual(model.scan.parameterIds, ['P1', 'P2']);
});

test('applySuggestedMapping 并入非空建议项', async () => {
  const { SettingsModel } = await loadModel();
  const model = new SettingsModel({ model: { paramMapping: { angleY: 'OLD' } } });
  model.scan.suggestedMapping = { angleX: 'P1', angleZ: null };
  model.applySuggestedMapping();
  assert.strictEqual(model.model().paramMapping.angleX, 'P1');
  assert.strictEqual(model.model().paramMapping.angleY, 'OLD');
  assert.ok(!('angleZ' in model.model().paramMapping) || model.model().paramMapping.angleZ === undefined);
});

test('setParamMapping 空值视为取消映射', async () => {
  const { SettingsModel } = await loadModel();
  const model = new SettingsModel({ model: {} });
  model.setParamMapping('angleX', 'P1');
  assert.strictEqual(model.model().paramMapping.angleX, 'P1');
  model.setParamMapping('angleX', '');
  assert.strictEqual(model.model().paramMapping.angleX, null);
});

test('applyImageScan 切到图片模式并合并文件', async () => {
  const { SettingsModel } = await loadModel();
  const model = new SettingsModel({ model: { imageFiles: [{ file: 'a.png', idle: true, talking: false, emotionName: '' }] } });
  model.applyImageScan('C:/imgs', [{ filename: 'a.png' }, { filename: 'b.png' }]);
  assert.strictEqual(model.model().type, 'image');
  assert.strictEqual(model.model().imageFolderPath, 'C:/imgs');
  assert.strictEqual(model.model().imageFiles[0].idle, true);
  assert.strictEqual(model.model().imageFiles[1].file, 'b.png');
});

test('syncExpressionsFromImages 由情绪名重算表情与 hasExpressions', async () => {
  const { SettingsModel } = await loadModel();
  const model = new SettingsModel({ model: { imageFiles: [{ file: 'a.png', emotionName: 'happy' }] } });
  model.syncExpressionsFromImages();
  assert.strictEqual(model.model().hasExpressions, true);
  assert.deepStrictEqual(model.model().expressions, [{ name: 'happy', label: 'happy', file: '' }]);
});

test('syncExpressionsFromImages 无情绪名时清空表情', async () => {
  const { SettingsModel } = await loadModel();
  const model = new SettingsModel({ model: { imageFiles: [{ file: 'a.png', emotionName: '' }] } });
  model.syncExpressionsFromImages();
  assert.strictEqual(model.model().hasExpressions, false);
  assert.deepStrictEqual(model.model().expressions, []);
});

test('applyEmotionEdits 写回表情动作并收集启用情绪', async () => {
  const { SettingsModel } = await loadModel();
  const model = new SettingsModel({ model: {} });
  const enabled = model.applyEmotionEdits({
    expressions: [
      { name: 'happy', file: 'h.exp3.json', durationSeconds: '2', enabled: true },
      { name: 'sad', file: '', durationSeconds: '', enabled: false }
    ],
    motions: [
      { name: 'wave', group: 'Tap', index: 0, durationSeconds: '1.5', enabled: true }
    ],
    defaultExpressionSeconds: '5',
    defaultMotionSeconds: '0'
  });
  const m = model.model();
  assert.deepStrictEqual(enabled, ['happy', 'wave']);
  assert.strictEqual(m.expressions.length, 2);
  assert.strictEqual(m.expressionDurations.happy, 2000);
  assert.ok(!('sad' in m.expressionDurations));
  assert.strictEqual(m.hasExpressions, true);
  assert.strictEqual(m.defaultExpressionDuration, 5000);
  assert.strictEqual(m.motionDurations.wave, 1500);
  // 缺省动作时长为 0,落到 3000 兜底。
  assert.strictEqual(m.defaultMotionDuration, 3000);
});

test('resetModel 重置为缺省并清空扫描', async () => {
  const { SettingsModel } = await loadModel();
  const model = new SettingsModel({ model: { type: 'live2d', folderPath: 'x' } });
  model.scan.parameterIds = ['P1'];
  model.resetModel();
  assert.strictEqual(model.model().type, 'none');
  assert.strictEqual(model.model().folderPath, null);
  assert.strictEqual(model.model().canvasYRatio, 0.60);
  assert.deepStrictEqual(model.scan.parameterIds, []);
});
