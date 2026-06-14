// audience: internal
// # live2d-renderer
// RenderAdapter 的 Live2D 实现:PIXI 与 Cubism 的私有字段访问全部收在此一文件。
// 不变量:Cubism 私有字段不外泄给本文件以外的任何模块;PIXI 与 Cubism 经构造注入,本文件不抓任何全局。

import { RenderAdapter, resolveAction, clampOpenness } from './model-renderer.js';

// Cubism 标准口型参数名,config.paramMapping.mouthOpenY 未给时回退到它。
const DEFAULT_MOUTH_PARAM = 'ParamMouthOpenY';

// 头部跟踪增益:把钳在 -1 到 1 的跟踪坐标放大成各角度参数的取值范围。
// 角度按度数偏转,眼球按归一化原值。
const TRACK_GAIN = { angleX: 30, angleY: -30, angleZ: -5, eyeBallX: 1, eyeBallY: -1 };

export class Live2dRenderer extends RenderAdapter {
  //// 经构造注入接收 PIXI、Cubism 模型与配置,持有内部状态,不抓全局 [@busybee 2026-06-13] ////
  // deps:{ pixiApp, model, config, fetchJson }。pixiApp 与 model 由组合根创建后注入,
  // fetchJson(url) 用于加载表情文件,把对 fetch 的依赖也收口在注入参数里。
  constructor(deps) {
    super();
    this.pixiApp = deps.pixiApp;
    this.model = deps.model;
    this.config = deps.config || {};
    this.fetchJson = deps.fetchJson;

    this.paramMap = null;
    this.actionTable = this._buildActionTable();
    this.expressionCache = {};
    this.activeExprParams = null;
    this.savedParamDefaults = null;
    this.mouthParam = (this.config.paramMapping && this.config.paramMapping.mouthOpenY) || DEFAULT_MOUTH_PARAM;

    this._buildParamMap();
  }

  //// 从配置的表情与动作清单建一张语义动作名到底层形态的表 [@busybee 2026-06-13] ////
  // 表情项来自 config.expressions:[{name, file}];动作项来自 config.motionEmotions:[{name, group, index}]。
  _buildActionTable() {
    const table = {};
    for (const expr of this.config.expressions || []) {
      table[expr.name] = { kind: 'expression', file: expr.file };
    }
    for (const motion of this.config.motionEmotions || []) {
      table[motion.name] = { kind: 'motion', group: motion.group, index: motion.index };
    }
    return table;
  }

  //// 建参数名到下标的映射,后续按名写值靠它 [@busybee 2026-06-13] ////
  _buildParamMap() {
    if (!this.model) return;
    const coreParams = this.model.internalModel.coreModel._model.parameters;
    this.paramMap = {};
    for (let i = 0; i < coreParams.count; i++) {
      this.paramMap[coreParams.ids[i]] = i;
    }
  }

  //// 经下标映射把一个参数写成目标值,封住 Cubism 私有字段访问 [@busybee 2026-06-13] ////
  _setParam(name, value) {
    if (!this.paramMap || this.paramMap[name] === undefined) return;
    this.model.internalModel.coreModel._model.parameters.values[this.paramMap[name]] = value;
  }

  //// 按语义动作名播放:动作走 Cubism motion,表情走缓存参数覆盖 [@busybee 2026-06-13] ////
  playAction(name) {
    const action = resolveAction(this.actionTable, name);
    if (!action || !this.model) return;
    if (action.kind === 'motion') {
      this.model.motion(action.group, action.index);
      return;
    }
    this._activateExpression(name);
  }

  //// 取出表情参数、记下受影响参数的默认值供回退、激活覆盖 [@busybee 2026-06-13] ////
  _activateExpression(name) {
    const params = this.expressionCache[name];
    if (!params) return;
    const defaults = this.model.internalModel.coreModel._model.parameters.defaultValues;
    this.savedParamDefaults = {};
    for (const p of params) {
      const idx = this.paramMap[p.Id];
      if (idx !== undefined) this.savedParamDefaults[p.Id] = defaults[idx];
    }
    this.activeExprParams = params;
  }

  //// 把当前激活的表情参数写进模型,每帧由组合根的 ticker 调一次 [@busybee 2026-06-13] ////
  applyExpression() {
    if (!this.activeExprParams) return;
    for (const p of this.activeExprParams) {
      this._setParam(p.Id, p.Value);
    }
  }

  //// 把受影响参数恢复到默认值并清空激活表情 [@busybee 2026-06-13] ////
  revertAction() {
    if (this.savedParamDefaults) {
      for (const [id, val] of Object.entries(this.savedParamDefaults)) {
        this._setParam(id, val);
      }
      this.savedParamDefaults = null;
    }
    this.activeExprParams = null;
  }

  //// 从注入的 fetchJson 加载表情文件,把参数表缓存供 playAction 用 [@busybee 2026-06-13] ////
  // modelDir 为表情文件所在目录,由组合根算好后传入。
  async loadExpressions(modelDir) {
    if (!this.fetchJson || !modelDir) return;
    for (const expr of this.config.expressions || []) {
      const json = await this.fetchJson(modelDir + '/' + expr.file);
      if (json && Array.isArray(json.Parameters)) {
        this.expressionCache[expr.name] = json.Parameters;
      }
    }
  }

  //// 设置口型开合度,把 0 到 1 写进 Cubism 的口型参数 [@busybee 2026-06-13] ////
  setMouth(openness) {
    this._setParam(this.mouthParam, clampOpenness(openness));
  }

  //// 按跟踪坐标偏转头部与眼球,经增益写入 config.paramMapping 指名的角度参数 [@busybee 2026-06-13] ////
  // x、y 为钳在 -1 到 1 的跟踪坐标;某语义键未在 paramMapping 配出参数名时跳过该项,不写值。
  // angleX/angleZ/eyeBallX 随 x 偏转,angleY/eyeBallY 随 y 偏转,增益与正负见 TRACK_GAIN。
  setTrack(x, y) {
    const mapping = this.config.paramMapping || {};
    if (mapping.angleX) this._setParam(mapping.angleX, x * TRACK_GAIN.angleX);
    if (mapping.angleY) this._setParam(mapping.angleY, y * TRACK_GAIN.angleY);
    if (mapping.angleZ) this._setParam(mapping.angleZ, x * TRACK_GAIN.angleZ);
    if (mapping.eyeBallX) this._setParam(mapping.eyeBallX, x * TRACK_GAIN.eyeBallX);
    if (mapping.eyeBallY) this._setParam(mapping.eyeBallY, y * TRACK_GAIN.eyeBallY);
  }

  //// 命中测试,返回被点中的交互区名或空 [@busybee 2026-06-13] ////
  // Cubism 模型的 hitTest 接受模型局部坐标 (x, y),返回命中的 HitArea 名称数组。
  hitTest(point) {
    if (!this.model || typeof this.model.hitTest !== 'function') return null;
    const hits = this.model.hitTest(point.x, point.y);
    if (hits && hits.length > 0) return hits[0];
    return null;
  }

  //// 从舞台移除模型并释放 PIXI 应用,清空内部状态 [@busybee 2026-06-13] ////
  dispose() {
    if (this.model) {
      if (this.pixiApp) this.pixiApp.stage.removeChild(this.model);
      this.model.destroy();
      this.model = null;
    }
    if (this.pixiApp) {
      this.pixiApp.destroy(false);
      this.pixiApp = null;
    }
    this.paramMap = null;
    this.expressionCache = {};
    this.activeExprParams = null;
    this.savedParamDefaults = null;
  }
}
