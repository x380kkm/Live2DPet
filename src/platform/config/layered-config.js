// audience: internal
// # layered-config
// 三层配置(全局、角色、意图)合并解析器:就近覆盖向上回退,各键锁定层在此声明。
// 不变量:查找到的层若低于某键的 floor 则该层的值无效;三层都是不可变纯数据快照。

// 三层从近到远的顺序:意图最近,全局最远。
const LAYER_ORDER = ['intent', 'character', 'global'];
// 每层的下沉深度,数值越大越下沉(越靠近意图)。
const LAYER_DEPTH = { global: 0, character: 1, intent: 2 };

// 键声明表:每个键标自己允许下沉到的最低层(floor)。
// 能力总闸与机器绑定项锁死全局;多数表现参数止于角色层;少数回应形态键可下沉到意图层。
const KEY_FLOOR = {
  // 全局层锁定:模型接入与机器绑定项,角色与意图即便写了也被忽略。
  apiKey: 'global',
  baseURL: 'global',
  modelName: 'global',
  // 大类与步骤两层模型配置整表:机器级设置,锁全局。
  modelConfig: 'global',
  uiLanguage: 'global',
  enabledMods: 'global',
  // 角色层为底:角色怎么表现,意图层不得改。
  emotionFrequency: 'character',
  interval: 'character',
  chatGap: 'character',
  model: 'character',
  bubble: 'character',
  // 意图层为底:这个意图这一次怎么回应,可一路下沉。
  enabledEmotions: 'intent',
  maxTokensMultiplier: 'intent'
};
// 未在声明表里的键默认止于角色层。
const DEFAULT_FLOOR = 'character';

class ScopeResolver {
  //// 构造注入一份已解析的三层快照 [@busybee 2026-06-13] ////
  constructor(resolvedScope) {
    this.scope = resolvedScope;
  }

  //// 返回某键允许下沉到的最低层 [@busybee 2026-06-13] ////
  lockedLayer(key) {
    return KEY_FLOOR[key] || DEFAULT_FLOOR;
  }

  //// 就近覆盖向上回退取键值,低于 floor 的层无效 [@busybee 2026-06-13] ////
  resolve(key, characterId, intentId) {
    const floor = this.lockedLayer(key);
    const floorDepth = LAYER_DEPTH[floor];
    // 从近到远逐层查找,跳过低于 floor 的层,取第一个有定义的值。
    for (const layer of LAYER_ORDER) {
      if (LAYER_DEPTH[layer] > floorDepth) continue;
      const layerData = this.scope[layer];
      if (layerData && Object.prototype.hasOwnProperty.call(layerData, key)) {
        return layerData[key];
      }
    }
    return undefined;
  }
  //// /就近覆盖向上回退取键值,低于 floor 的层无效 ////
}

class ResolvedScope {
  constructor() {
    // 全局层:这台机器与这个用户的设置
    this.global = null;
    // 角色层:这个角色怎么表现
    this.character = null;
    // 意图层:这个意图这一次怎么回应
    this.intent = null;
  }
}

module.exports = { ScopeResolver, ResolvedScope, KEY_FLOOR, DEFAULT_FLOOR };
