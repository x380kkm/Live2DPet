// audience: internal
// # fewshot-bank
// few-shot 银行:按名字组织的可替换样例库,分结构、语气、场景台词三类。
// 不变量:结构样例不得含成品句子(只搭骨架),校验设在入库时;场景台词样例是明确豁免、必须携带成品台词。
//
// 三类样例与各自用途:
// 结构样例(全局共享):{ name, slots:[槽名...], turns:[{ role, template }] }。template 只含骨架与 {{槽名}} 占位,
//   字面文本不得带成品措辞,供 mod 与意图的结构示范。
// 语气样例(按角色):{ name, characterId, fillers:{ 槽名: 文本 } },只供给槽位填充,不带轮次结构。
// 场景台词样例(按角色):{ name, characterId, scenes:[{ scene, lines:[成品台词...] }] }。这是台词生成的语气示范,
//   成品台词是 few-shot 的内容主体、必须保留,故此类样例豁免「不含成品措辞」这条;
//   成品台词属用户掌控的人设数据,本库只定格式与渲染,不产出内容。模型据此模仿文风但不照抄(指令在 prompt-composer)。
// compose 把结构骨架的槽位用语气填充与调用方槽位填满;composeSceneTurns 把场景台词渲染成示例轮次。

// 槽位占位形如 {{slotName}},与 prompt-builder.resolveTemplate 的插槽机制一致。
const SLOT_PATTERN = /\{\{\s*([a-zA-Z][\w]*)\s*\}\}/g;
// 成品措辞探测:字面文本里出现句末标点或引号即视为成品句子,结构样例不得含。
const FINISHED_WORDING = /[。！？!?“”"]/;

//// 取出一段文本里引用到的所有槽名 [@x380kkm 2026-06-13] ////
function slotsReferencedIn(text) {
  const names = [];
  let match;
  SLOT_PATTERN.lastIndex = 0;
  while ((match = SLOT_PATTERN.exec(text)) !== null) {
    names.push(match[1]);
  }
  return names;
}

//// 取出一段文本里挖去槽位后的字面残留 [@x380kkm 2026-06-13] ////
function literalResidueOf(text) {
  return text.replace(SLOT_PATTERN, ' ');
}

//// 校验一条结构样例:声明槽位、占位与声明一致、字面不含成品措辞 [@x380kkm 2026-06-13] ////
// 入库期抛错,使坏样例进不了库;运行期不再重复校验。
function assertStructureSample(sample) {
  if (!sample || typeof sample.name !== 'string' || sample.name.length === 0) {
    throw new Error('结构样例缺少 name');
  }
  if (!Array.isArray(sample.slots)) {
    throw new Error(`结构样例 ${sample.name} 缺少 slots 声明`);
  }
  if (!Array.isArray(sample.turns) || sample.turns.length === 0) {
    throw new Error(`结构样例 ${sample.name} 缺少 turns`);
  }
  const declared = new Set(sample.slots);
  for (const turn of sample.turns) {
    if (!turn || typeof turn.role !== 'string' || typeof turn.template !== 'string') {
      throw new Error(`结构样例 ${sample.name} 的 turn 需含 role 与 template`);
    }
    // 占位引用必须在 slots 里声明过,杜绝运行期才发现的未知槽。
    for (const ref of slotsReferencedIn(turn.template)) {
      if (!declared.has(ref)) {
        throw new Error(`结构样例 ${sample.name} 引用了未声明的槽位 ${ref}`);
      }
    }
    // 槽位之外的字面文本不得是成品句子,守住结构只示范骨架。
    if (FINISHED_WORDING.test(literalResidueOf(turn.template))) {
      throw new Error(`结构样例 ${sample.name} 的字面文本含成品措辞,只允许骨架与槽位`);
    }
  }
}

//// 校验一条语气样例:绑定角色、只供槽位填充、不带轮次结构 [@x380kkm 2026-06-13] ////
function assertToneSample(sample) {
  if (!sample || typeof sample.name !== 'string' || sample.name.length === 0) {
    throw new Error('语气样例缺少 name');
  }
  if (typeof sample.characterId !== 'string' || sample.characterId.length === 0) {
    throw new Error(`语气样例 ${sample.name} 缺少 characterId`);
  }
  if (!sample.fillers || typeof sample.fillers !== 'object') {
    throw new Error(`语气样例 ${sample.name} 缺少 fillers`);
  }
  // 语气样例不得自带轮次结构,结构只由结构样例提供,守住两者互不可见。
  if ('turns' in sample) {
    throw new Error(`语气样例 ${sample.name} 不得携带 turns`);
  }
  for (const [slot, value] of Object.entries(sample.fillers)) {
    if (typeof value !== 'string') {
      throw new Error(`语气样例 ${sample.name} 的槽位 ${slot} 填充须为字符串`);
    }
  }
}

//// 校验一条场景台词样例:绑定角色、每个场景含描述与至少一条成品台词 [@x380kkm 2026-06-13] ////
// 与结构样例相反,本类样例必须携带成品台词(明确豁免),故不查成品措辞。
function assertSceneSample(sample) {
  if (!sample || typeof sample.name !== 'string' || sample.name.length === 0) {
    throw new Error('场景台词样例缺少 name');
  }
  if (typeof sample.characterId !== 'string' || sample.characterId.length === 0) {
    throw new Error(`场景台词样例 ${sample.name} 缺少 characterId`);
  }
  if (!Array.isArray(sample.scenes) || sample.scenes.length === 0) {
    throw new Error(`场景台词样例 ${sample.name} 缺少 scenes`);
  }
  for (const scene of sample.scenes) {
    if (!scene || typeof scene.scene !== 'string' || scene.scene.length === 0) {
      throw new Error(`场景台词样例 ${sample.name} 有场景缺少 scene 描述`);
    }
    if (!Array.isArray(scene.lines) || scene.lines.length === 0) {
      throw new Error(`场景台词样例 ${sample.name} 的场景「${scene.scene}」缺少成品台词 lines`);
    }
    for (const line of scene.lines) {
      if (typeof line !== 'string' || line.length === 0) {
        throw new Error(`场景台词样例 ${sample.name} 的台词须为非空字符串`);
      }
    }
  }
}

class FewShotBank {
  //// 建立结构、语气、场景台词三套存储 [@x380kkm 2026-06-13] ////
  // 结构按名全局共享;语气与场景台词按 characterId 分桶,各角色彼此隔离。
  constructor() {
    this._structures = new Map();
    this._tonesByCharacter = new Map();
    this._sceneSetsByCharacter = new Map();
  }

  //// 入库一条结构样例,入库期校验骨架不含成品措辞 [@x380kkm 2026-06-13] ////
  registerStructure(sample) {
    assertStructureSample(sample);
    this._structures.set(sample.name, sample);
  }

  //// 入库一条语气样例,按角色分桶并校验只供槽位填充 [@x380kkm 2026-06-13] ////
  registerTone(sample) {
    assertToneSample(sample);
    let bucket = this._tonesByCharacter.get(sample.characterId);
    if (!bucket) {
      bucket = new Map();
      this._tonesByCharacter.set(sample.characterId, bucket);
    }
    bucket.set(sample.name, sample);
  }

  //// 按名解析全局结构样例,未命中返回 null [@x380kkm 2026-06-13] ////
  resolveStructure(ref) {
    return this._structures.get(ref) || null;
  }

  //// 按名解析某角色的语气样例,跨角色不可见,未命中返回 null [@x380kkm 2026-06-13] ////
  resolveTone(ref, characterId) {
    const bucket = this._tonesByCharacter.get(characterId);
    if (!bucket) {
      return null;
    }
    return bucket.get(ref) || null;
  }

  //// 用语气填充与调用方槽位填满结构骨架,产出可读样例轮次 [@x380kkm 2026-06-13] ////
  // 填充优先级:调用方 slots 盖过语气 fillers;槽位无填充则留空骨架,绝不外漏占位文本。
  compose(structure, tone, slots) {
    if (!structure) {
      return [];
    }
    const fillers = (tone && tone.fillers) || {};
    const overrides = slots || {};
    const turns = [];
    for (const turn of structure.turns) {
      const filled = turn.template.replace(SLOT_PATTERN, (_, name) => {
        if (Object.prototype.hasOwnProperty.call(overrides, name)) {
          return overrides[name];
        }
        if (Object.prototype.hasOwnProperty.call(fillers, name)) {
          return fillers[name];
        }
        return '';
      });
      turns.push({ role: turn.role, content: filled });
    }
    return turns;
  }

  //// 入库一条场景台词样例,按角色分桶;此类必须携带成品台词 [@x380kkm 2026-06-13] ////
  registerSceneSet(sample) {
    assertSceneSample(sample);
    let bucket = this._sceneSetsByCharacter.get(sample.characterId);
    if (!bucket) {
      bucket = new Map();
      this._sceneSetsByCharacter.set(sample.characterId, bucket);
    }
    bucket.set(sample.name, sample);
  }

  //// 按名解析某角色的场景台词样例,跨角色不可见,未命中返回 null [@x380kkm 2026-06-13] ////
  resolveSceneSet(name, characterId) {
    const bucket = this._sceneSetsByCharacter.get(characterId);
    if (!bucket) {
      return null;
    }
    return bucket.get(name) || null;
  }

  //// 把场景台词样例渲染成示例轮次:每条成品台词配一个「场景:X」用户轮与角色台词回应轮 [@x380kkm 2026-06-13] ////
  // options.maxScenes 限场景数、maxLinesPerScene 限每场景台词数,缺省不限;成品台词原样带出,不改写。
  composeSceneTurns(sceneSet, options = {}) {
    if (!sceneSet || !Array.isArray(sceneSet.scenes)) {
      return [];
    }
    const maxScenes = options.maxScenes;
    const maxLines = options.maxLinesPerScene;
    const turns = [];
    const scenes = maxScenes === undefined ? sceneSet.scenes : sceneSet.scenes.slice(0, maxScenes);
    for (const scene of scenes) {
      const lines = maxLines === undefined ? scene.lines : scene.lines.slice(0, maxLines);
      for (const line of lines) {
        turns.push({ role: 'user', content: `场景:${scene.scene}` });
        turns.push({ role: 'assistant', content: line });
      }
    }
    return turns;
  }
}

module.exports = { FewShotBank };
