// 用 mock 注入断言 live2d-renderer 的行为契约,不触真实 PIXI 与 Cubism。
const { test } = require('node:test');
const assert = require('node:assert');
const { Live2dRenderer } = require('../../src/platform/render/live2d-renderer');

// 造一个记录调用的假 Cubism 模型,暴露 playMotion、参数表、hitTest 与 destroy
function makeFakeModel(paramIds) {
  const count = paramIds.length;
  return {
    motionCalls: [],
    hitArg: null,
    hitReturn: [],
    destroyed: false,
    internalModel: {
      coreModel: {
        _model: {
          parameters: {
            count,
            ids: paramIds,
            values: new Array(count).fill(0),
            defaultValues: paramIds.map((_, i) => i + 1)
          }
        }
      }
    },
    motion(group, index) { this.motionCalls.push([group, index]); },
    hitTest(x, y) { this.hitArg = { x, y }; return this.hitReturn; },
    destroy() { this.destroyed = true; }
  };
}

// 造一个记录调用的假 PIXI 应用
function makeFakePixiApp() {
  return {
    destroyed: false,
    removed: [],
    stage: { removeChild(m) { this.removedChild = m; } },
    destroy(removeView) { this.destroyed = true; this.destroyArg = removeView; }
  };
}

function makeRenderer(extra = {}) {
  const model = makeFakeModel(['ParamMouthOpenY', 'ParamAngleX', 'ParamEyeLOpen']);
  const pixiApp = makeFakePixiApp();
  const config = {
    expressions: [{ name: 'happy', file: 'happy.exp3.json' }],
    motionEmotions: [{ name: 'wave', group: 'TapBody', index: 1 }],
    ...extra
  };
  const renderer = new Live2dRenderer({ pixiApp, model, config, fetchJson: extra.fetchJson });
  return { renderer, model, pixiApp };
}

test('构造时建好参数名到下标的映射', () => {
  const { renderer } = makeRenderer();
  assert.deepStrictEqual(renderer.paramMap, {
    ParamMouthOpenY: 0, ParamAngleX: 1, ParamEyeLOpen: 2
  });
});

test('playAction 对动作名调用底层 motion 并带 group 与 index', () => {
  const { renderer, model } = makeRenderer();
  renderer.playAction('wave');
  assert.deepStrictEqual(model.motionCalls, [['TapBody', 1]]);
});

test('playAction 对表情名激活表情参数覆盖,applyExpression 写进模型', () => {
  const { renderer, model } = makeRenderer();
  renderer.expressionCache['happy'] = [{ Id: 'ParamEyeLOpen', Value: 0.7 }];
  renderer.playAction('happy');
  assert.deepStrictEqual(renderer.activeExprParams, [{ Id: 'ParamEyeLOpen', Value: 0.7 }]);
  renderer.applyExpression();
  assert.strictEqual(model.internalModel.coreModel._model.parameters.values[2], 0.7);
});

test('playAction 对未知名既不调 motion 也不激活表情', () => {
  const { renderer, model } = makeRenderer();
  renderer.playAction('unknown');
  assert.strictEqual(model.motionCalls.length, 0);
  assert.strictEqual(renderer.activeExprParams, null);
});

test('revertAction 把表情受影响参数恢复到默认值并清空激活表情', () => {
  const { renderer, model } = makeRenderer();
  renderer.expressionCache['happy'] = [{ Id: 'ParamEyeLOpen', Value: 0.7 }];
  renderer.playAction('happy');
  renderer.applyExpression();
  renderer.revertAction();
  // ParamEyeLOpen 下标 2,默认值为 2 + 1 = 3
  assert.strictEqual(model.internalModel.coreModel._model.parameters.values[2], 3);
  assert.strictEqual(renderer.activeExprParams, null);
  assert.strictEqual(renderer.savedParamDefaults, null);
});

test('setMouth 把钳到 0 到 1 的值写进口型参数', () => {
  const { renderer, model } = makeRenderer();
  renderer.setMouth(0.4);
  assert.strictEqual(model.internalModel.coreModel._model.parameters.values[0], 0.4);
  renderer.setMouth(3);
  assert.strictEqual(model.internalModel.coreModel._model.parameters.values[0], 1);
});

test('setMouth 用配置的 paramMapping.mouthOpenY 覆盖默认口型参数名', () => {
  const { renderer, model } = makeRenderer({ paramMapping: { mouthOpenY: 'ParamAngleX' } });
  renderer.setMouth(0.5);
  // 写到 ParamAngleX(下标 1)而非默认 ParamMouthOpenY
  assert.strictEqual(model.internalModel.coreModel._model.parameters.values[1], 0.5);
  assert.strictEqual(model.internalModel.coreModel._model.parameters.values[0], 0);
});

test('loadExpressions 经注入的 fetchJson 把参数表缓存', async () => {
  const fetched = [];
  const fetchJson = async (url) => {
    fetched.push(url);
    return { Parameters: [{ Id: 'ParamEyeLOpen', Value: 0.9 }] };
  };
  const { renderer } = makeRenderer({ fetchJson });
  await renderer.loadExpressions('file:///models/cat');
  assert.deepStrictEqual(fetched, ['file:///models/cat/happy.exp3.json']);
  assert.deepStrictEqual(renderer.expressionCache['happy'], [{ Id: 'ParamEyeLOpen', Value: 0.9 }]);
});

test('hitTest 把点传给底层模型并返回首个命中区', () => {
  const { renderer, model } = makeRenderer();
  model.hitReturn = ['Head', 'Body'];
  const hit = renderer.hitTest({ x: 12, y: 34 });
  assert.deepStrictEqual(model.hitArg, { x: 12, y: 34 });
  assert.strictEqual(hit, 'Head');
});

test('hitTest 无命中时返回空', () => {
  const { renderer, model } = makeRenderer();
  model.hitReturn = [];
  assert.strictEqual(renderer.hitTest({ x: 0, y: 0 }), null);
});

test('dispose 从舞台移除模型、销毁模型与 PIXI 应用、清空状态', () => {
  const { renderer, model, pixiApp } = makeRenderer();
  renderer.dispose();
  assert.strictEqual(pixiApp.stage.removedChild, model);
  assert.strictEqual(model.destroyed, true);
  assert.strictEqual(pixiApp.destroyed, true);
  assert.strictEqual(renderer.model, null);
  assert.strictEqual(renderer.pixiApp, null);
  assert.strictEqual(renderer.paramMap, null);
});
