// audience: internal
// # character-stage
// 统一角色表现层:单一透明覆盖窗口经 CSS 协调角色头部、mod 前端槽、对话气泡的布局。
// 不变量:除交互元素外整窗点击穿透;同一时刻 mod 槽与气泡至多一个占主导。

import { ExpressionArea, Occupant } from './expression-area.js';

//// 表达区在头部周围可用的尺寸预算:宽随舞台、高占舞台一截、各方向留头部余量 [@x380kkm 2026-06-13] ////
// stageSize 为覆盖窗口尺寸;reserve 为给头部预留的高度比例;返回表达区与槽的尺寸上限。
export function computeExpressionBudget(stageSize, reserve = 0.4) {
  const ratio = clampRatio(reserve);
  return {
    width: stageSize.width,
    height: Math.round(stageSize.height * (1 - ratio)),
  };
}

//// 把一个请求尺寸钳进表达区预算上限,不放大、不越界 [@x380kkm 2026-06-13] ////
export function fitWithinBudget(requested, budget) {
  return {
    width: Math.min(requested.width, budget.width),
    height: Math.min(requested.height, budget.height),
  };
}

//// 把比例钳进 0 到 1 [@x380kkm 2026-06-13] ////
function clampRatio(value) {
  if (typeof value !== 'number' || Number.isNaN(value)) return 0;
  if (value < 0) return 0;
  if (value > 1) return 1;
  return value;
}

export class CharacterStage {
  //// 经构造注入舞台元素、表达区与两视图,装配排他仲裁 [@x380kkm 2026-06-13] ////
  // deps:{ stageElement, stageSize, modSlot, chatBubble, headAdapter? }。
  constructor(deps) {
    this.stageElement = deps.stageElement;
    this.stageSize = deps.stageSize || { width: 0, height: 0 };
    this.modSlot = deps.modSlot;
    this.chatBubble = deps.chatBubble;
    this.headAdapter = deps.headAdapter || null;

    //// 表达区以两视图的隐藏为停用钩子,保证主导切换时另一占用者被收起 [@x380kkm 2026-06-13] ////
    this.expressionArea = new ExpressionArea({
      [Occupant.ModFrontend]: { deactivate: () => this.modSlot && this.modSlot.clear() },
      [Occupant.Bubble]: { deactivate: () => this.chatBubble && this.chatBubble.hide() },
    });
  }

  //// 挂角色头部:记下渲染适配,后续情绪经它驱动 [@x380kkm 2026-06-13] ////
  mountHead(adapter) {
    this.headAdapter = adapter;
    return adapter;
  }

  //// 分配 mod 前端槽:槽占主导、尺寸钳进表达区预算,返回带尺寸上限的槽句柄 [@x380kkm 2026-06-13] ////
  allocateModSlot(modId) {
    this.expressionArea.takeOver(Occupant.ModFrontend);
    const budget = computeExpressionBudget(this.stageSize);
    return { modId, slot: this.modSlot, sizeCap: budget };
  }
  //// /分配 mod 前端槽 ////

  //// 显示气泡:气泡占主导,把文本交给气泡视图 [@x380kkm 2026-06-13] ////
  showBubble(text) {
    this.expressionArea.takeOver(Occupant.Bubble);
    if (this.chatBubble) this.chatBubble.show(text);
  }
  //// /显示气泡 ////

  //// 仲裁:守住表达区同一时刻至多一个占主导的不变量 [@x380kkm 2026-06-13] ////
  // 表达区的 takeOver 已在切换时停用原主导;此处对外暴露当前主导供宿主查询。
  arbitrate() {
    return this.expressionArea.dominant;
  }
}
