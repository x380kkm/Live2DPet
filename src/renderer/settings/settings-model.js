// audience: internal
// # settings-model
// 设置面板的配置数据模型与纯转换:子面板以这份内存快照为真相来源,而非从 DOM 现场抓取重建。
// 不变量:本文件不碰 DOM、不碰 window;只做纯数据快照持有与无副作用转换,可脱离浏览器单测。

// 模型参数到 i18n 标签键的固定映射,决定参数映射面板的行顺序。
export const PARAM_LABELS = {
  angleX: 'param.angleX', angleY: 'param.angleY', angleZ: 'param.angleZ',
  bodyAngleX: 'param.bodyAngleX', eyeBallX: 'param.eyeBallX', eyeBallY: 'param.eyeBallY'
};

// 每个 VVM 文件包含的角色描述,作为语音模型勾选面板的单一目录。
export const VVM_CHARACTERS = {
  '0.vvm': '四国めたん, ずんだもん, 春日部つむぎ, 雨晴はう',
  '1.vvm': '冥鳴ひまり',
  '2.vvm': '九州そら',
  '3.vvm': '波音リツ, 中国うさぎ',
  '4.vvm': '玄野武宏, 剣崎雌雄',
  '5.vvm': '四国めたん(ささやき), ずんだもん(ささやき), 九州そら(ささやき)',
  '6.vvm': 'No.7',
  '7.vvm': '後鬼',
  '8.vvm': 'WhiteCUL',
  '9.vvm': '白上虎太郎',
  '10.vvm': '玄野武宏(追加), ちび式じい',
  '11.vvm': '櫻歌ミコ, ナースロボ＿タイプＴ',
  '12.vvm': '†聖騎士 紅桜†, 雀松朱司, 麒ヶ島宗麟',
  '13.vvm': '春歌ナナ, 猫使アル, 猫使ビィ',
  '14.vvm': '栗田まろん, あいえるたん, 満別花丸, 琴詠ニア',
  '15.vvm': 'ずんだもん(追加), 青山龍星, もち子さん, 小夜/SAYO',
  '16.vvm': '後鬼(追加)',
  '17.vvm': 'Voidoll',
  '18.vvm': 'ぞん子, 中部つるぎ',
  '19.vvm': '離途, 黒沢冴白',
  '20.vvm': 'ユーレイちゃん',
  '21.vvm': '東北ずん子, 東北きりたん, 東北イタコ, 猫使(追加)',
  '22.vvm': 'あんこもん',
  '23.vvm': 'あんこもん(ささやき)',
  'n0.vvm': 'VOICEVOX Nemo (女声1-6, 男声1-3)'
};

// AI 步骤目录在渲染侧的镜像:与 src/shared/step-catalog.js 镜像,供模型配置面板枚举步骤。
export const AI_CATEGORIES = ['vlm', 'llm', 'translate'];
export const MODEL_PRESETS = ['openai-chat', 'claude', 'openai-responses'];
export const AI_STEP_CATALOG = [
  { id: 'keyframeSelect', category: 'vlm', label: '关键帧选择' },
  { id: 'situationExtract', category: 'vlm', label: '态势抽取' },
  { id: 'dialogue', category: 'llm', label: '台词生成' },
  { id: 'intentRoute', category: 'llm', label: '意图与场景路由' },
  { id: 'emotionSelect', category: 'llm', label: '情绪选择' },
  { id: 'reaction', category: 'llm', label: '事件反应' },
  { id: 'modGenerate', category: 'llm', label: 'mod 生成' },
  { id: 'translate', category: 'translate', label: '翻译' }
];

//// 造一份空的两层模型配置骨架:三大类与步骤表加全局 system 注入 [@busybee 2026-06-13] ////
export function defaultModelConfig() {
  return { categories: {}, steps: {}, systemInjection: '' };
}

//// 把候选参数 id 排序成建议项在前、其余按字母序 [@busybee 2026-06-13] ////
export function sortParamCandidates(scannedIds, suggested) {
  return [...scannedIds].sort((a, b) => {
    if (a === suggested) return -1;
    if (b === suggested) return 1;
    return a.localeCompare(b);
  });
}

//// 把秒转成毫秒整数,非正数视为缺省返回 null [@busybee 2026-06-13] ////
export function secondsToMs(seconds) {
  const value = parseFloat(seconds);
  if (!(value > 0)) return null;
  return Math.round(value * 1000);
}

//// 把毫秒转成秒,缺失返回空串供输入框占位 [@busybee 2026-06-13] ////
export function msToSeconds(ms) {
  if (!ms) return '';
  return ms / 1000;
}

//// 取一个带正数下限兜底的秒转毫秒,用于缺省时长 [@busybee 2026-06-13] ////
export function secondsToMsWithFallback(seconds, fallbackMs) {
  return secondsToMs(seconds) || fallbackMs;
}

//// 把扫描出的图片列表与既有配置按文件名合并,保留既有的分类开关 [@busybee 2026-06-13] ////
export function mergeImageFiles(existingFiles, scannedImages) {
  const existingByName = {};
  for (const file of existingFiles || []) existingByName[file.file] = file;
  return scannedImages.map((image) => {
    const existing = existingByName[image.filename];
    return existing || { file: image.filename, idle: false, talking: false, emotionName: '' };
  });
}

//// 从图片的情绪名去重生成表情列表,供情绪系统使用 [@busybee 2026-06-13] ////
export function deriveExpressionsFromImageEmotions(imageFiles) {
  const names = new Set();
  for (const file of imageFiles || []) {
    if (file.emotionName) names.add(file.emotionName);
  }
  return [...names].map((name) => ({ name, label: name, file: '' }));
}

//// 把扫描出的表情结果映射成配置里的表情项 [@busybee 2026-06-13] ////
export function expressionsFromScan(scannedExpressions) {
  return (scannedExpressions || []).map((expr) => ({
    name: expr.name, label: expr.name, file: expr.file
  }));
}

//// 把扫描出的分组动作扁平成动作情绪项,文件名去路径去后缀作名 [@busybee 2026-06-13] ////
export function motionEmotionsFromScan(scannedMotions) {
  const result = [];
  for (const [group, entries] of Object.entries(scannedMotions || {})) {
    entries.forEach((entry, index) => {
      const fileName = (entry.file || '')
        .replace(/^.*[\\/]/, '')
        .replace('.motion3.json', '');
      result.push({ name: fileName || `${group}_${index}`, group, index });
    });
  }
  return result;
}

//// 为每个 VVM 文件算出勾选面板的状态:磁盘是否就绪、是否选中、是否禁用 [@busybee 2026-06-13] ////
export function availableVvmState(availableOnDisk, loadedFiles) {
  const loaded = new Set(loadedFiles || []);
  const onDisk = new Set(availableOnDisk || []);
  return Object.keys(VVM_CHARACTERS).map((file) => {
    const present = onDisk.has(file);
    return {
      file,
      description: VVM_CHARACTERS[file],
      onDisk: present,
      checked: present && loaded.has(file),
      disabled: !present
    };
  });
}

//// 在说话人元数据里按 styleId 定位说话人下标与该说话人的样式列表 [@busybee 2026-06-13] ////
export function resolveStyleSelection(metas, styleId) {
  for (let speakerIndex = 0; speakerIndex < (metas || []).length; speakerIndex++) {
    const styles = metas[speakerIndex].styles || [];
    if (styles.some((style) => style.id === styleId)) {
      return { speakerIndex, styleId };
    }
  }
  return { speakerIndex: 0, styleId: null };
}

//// 由倍率算出展示用的最大 token 数,基准 2048 [@busybee 2026-06-13] ////
export function tokenCountForMultiplier(multiplier) {
  return Math.round(2048 * multiplier);
}

//// 设置面板的配置数据模型:持有一份内存快照作真相来源,产出落盘用的补丁 [@busybee 2026-06-13] ////
export class SettingsModel {
  constructor(snapshot = {}) {
    // 深拷贝传入快照,避免与调用方共享引用导致意外联动。
    this.config = JSON.parse(JSON.stringify(snapshot));
    if (!this.config.model) this.config.model = { type: 'none' };
    // 模型扫描的瞬时结果不入持久配置,只驻留模型生命周期内。
    this.scan = { parameterIds: [], suggestedMapping: {}, motions: {} };
  }

  //// 取模型子配置的引用,缺失就地补建 [@busybee 2026-06-13] ////
  model() {
    if (!this.config.model) this.config.model = { type: 'none' };
    return this.config.model;
  }

  //// 记录一次模型扫描结果,供参数映射与列表面板渲染 [@busybee 2026-06-13] ////
  applyScan(scanResult) {
    this.scan = {
      parameterIds: scanResult.parameterIds || [],
      suggestedMapping: scanResult.suggestedMapping || {},
      motions: scanResult.motions || {}
    };
    const model = this.model();
    model.type = 'live2d';
    model.expressionDurations = {};
    model.motionDurations = {};
    model.hasExpressions = (scanResult.expressions || []).length > 0;
    model.expressions = expressionsFromScan(scanResult.expressions);
    model.motionEmotions = motionEmotionsFromScan(scanResult.motions);
  }

  //// 把建议映射并入当前参数映射,空建议项跳过 [@busybee 2026-06-13] ////
  applySuggestedMapping() {
    const model = this.model();
    if (!model.paramMapping) model.paramMapping = {};
    for (const [key, value] of Object.entries(this.scan.suggestedMapping || {})) {
      if (value) model.paramMapping[key] = value;
    }
  }

  //// 设置某个语义参数映射到的模型参数 id,空值视为取消映射 [@busybee 2026-06-13] ////
  setParamMapping(semanticKey, paramId) {
    const model = this.model();
    if (!model.paramMapping) model.paramMapping = {};
    model.paramMapping[semanticKey] = paramId || null;
  }

  //// 用扫描出的图片列表合并刷新图片配置,保留既有分类开关 [@busybee 2026-06-13] ////
  applyImageScan(folderPath, scannedImages) {
    const model = this.model();
    model.type = 'image';
    model.imageFolderPath = folderPath;
    model.imageFiles = mergeImageFiles(model.imageFiles, scannedImages);
  }

  //// 由图片情绪名重算表情列表,供保存图片模式时同步情绪系统 [@busybee 2026-06-13] ////
  syncExpressionsFromImages() {
    const model = this.model();
    const expressions = deriveExpressionsFromImageEmotions(model.imageFiles);
    model.expressions = expressions;
    model.hasExpressions = expressions.length > 0;
  }

  //// 把面板收集到的表情与动作及缺省时长写回模型,返回启用的情绪名清单 [@busybee 2026-06-13] ////
  applyEmotionEdits(edits) {
    const model = this.model();
    const expressionDurations = {};
    const enabledEmotions = [];
    const expressions = edits.expressions.map((item) => {
      const ms = secondsToMs(item.durationSeconds);
      if (ms) expressionDurations[item.name] = ms;
      if (item.enabled) enabledEmotions.push(item.name);
      return { name: item.name, label: item.name, file: item.file || '' };
    });
    const motionDurations = {};
    const motionEmotions = edits.motions.map((item) => {
      const ms = secondsToMs(item.durationSeconds);
      if (ms) motionDurations[item.name] = ms;
      if (item.enabled) enabledEmotions.push(item.name);
      return { name: item.name, group: item.group, index: item.index };
    });
    model.expressions = expressions;
    model.expressionDurations = expressionDurations;
    model.hasExpressions = expressions.length > 0;
    model.defaultExpressionDuration = secondsToMsWithFallback(edits.defaultExpressionSeconds, 5000);
    model.motionEmotions = motionEmotions;
    model.motionDurations = motionDurations;
    model.defaultMotionDuration = secondsToMsWithFallback(edits.defaultMotionSeconds, 3000);
    return enabledEmotions;
  }

  //// 取两层模型配置的引用,缺失就地补建空骨架 [@busybee 2026-06-13] ////
  modelConfig() {
    if (!this.config.modelConfig) this.config.modelConfig = defaultModelConfig();
    const mc = this.config.modelConfig;
    if (!mc.categories) mc.categories = {};
    if (!mc.steps) mc.steps = {};
    if (mc.systemInjection === undefined) mc.systemInjection = '';
    return mc;
  }

  //// 设置某大类的模型身份字段,逐键合并不抹去未给字段 [@busybee 2026-06-13] ////
  setCategoryModel(category, fields) {
    const mc = this.modelConfig();
    mc.categories[category] = { ...(mc.categories[category] || {}), ...fields };
  }

  //// 设置某步骤是否跟随大类:跟随则用大类模型,关掉用步骤自己的 [@busybee 2026-06-13] ////
  setStepFollowCategory(stepId, follow) {
    const mc = this.modelConfig();
    mc.steps[stepId] = { ...(mc.steps[stepId] || {}), followCategory: !!follow };
  }

  //// 设置某步骤的覆盖字段,逐键合并 [@busybee 2026-06-13] ////
  setStepOverride(stepId, fields) {
    const mc = this.modelConfig();
    mc.steps[stepId] = { ...(mc.steps[stepId] || {}), ...fields };
  }

  //// 设置全局额外 system 注入,与出厂提示词合并;不审查、用户自负 [@busybee 2026-06-13] ////
  setSystemInjection(text) {
    this.modelConfig().systemInjection = text || '';
  }

  //// 把模型重置为一份全新的缺省模型配置 [@busybee 2026-06-13] ////
  resetModel() {
    this.config.model = {
      type: 'none', folderPath: null, modelJsonFile: null,
      copyToUserData: true, userDataModelPath: null,
      staticImagePath: null, bottomAlignOffset: 0.5,
      gifExpressions: {},
      imageFolderPath: null, imageFiles: [], imageCropScale: 1.0,
      paramMapping: { angleX: null, angleY: null, angleZ: null, bodyAngleX: null, eyeBallX: null, eyeBallY: null },
      hasExpressions: false, expressions: [],
      expressionDurations: {}, defaultExpressionDuration: 5000,
      motionEmotions: [], motionDurations: {}, defaultMotionDuration: 3000,
      canvasYRatio: 0.60
    };
    this.scan = { parameterIds: [], suggestedMapping: {}, motions: {} };
  }
}
