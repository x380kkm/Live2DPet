// audience: internal
// # vlm-extractor
// 从关键帧选取与解析态势:只做态势抽取一件事,输出桌面态势摘要。
// 不变量:内部那次关键帧选择的大模型调用受自身退避区间约束,不进角色反应链。
//
// 依赖经构造注入:llmClient 做无关供应商的补全调用;buffer 是关键帧来源;
// prompts 给定选帧与抽态势的系统提示词(由调用方按语言解析,本模块不内联成品措辞);
// now 为注入时钟。选帧与抽态势各有独立的退避区间,失败后退避翻倍到上限。

const { StepId } = require('../../shared/step-catalog');

//// 把大模型返回的文本解析为帧索引数组:先整体解析,再退而抓首个方括号片段 [@busybee 2026-06-13] ////
function parseFrameIndices(text, frameCount) {
  if (!text) return [];
  const accept = (arr) =>
    Array.isArray(arr)
      ? arr.filter((i) => typeof i === 'number' && i >= 0 && i < frameCount)
      : [];
  try {
    return accept(JSON.parse(text));
  } catch {}
  const match = text.match(/\[[\s\S]*?\]/);
  if (match) {
    try {
      return accept(JSON.parse(match[0]));
    } catch {}
  }
  return [];
}
//// /把大模型返回的文本解析为帧索引数组 ////

class VlmExtractor {
  //// 构造注入大模型客户端、关键帧缓冲、提示词与退避配置 [@busybee 2026-06-13] ////
  constructor(deps = {}, config = {}) {
    this.llmClient = deps.llmClient;
    this.buffer = deps.buffer;
    this.now = deps.now || (() => Date.now());
    // prompts.select 选帧系统提示词;prompts.situation 抽态势系统提示词。
    this.prompts = deps.prompts || {};

    this.selectIntervalMs = config.selectIntervalMs ?? 120000;
    this.situationBaseIntervalMs = config.situationBaseIntervalMs ?? 15000;
    this.situationMaxIntervalMs = config.situationMaxIntervalMs ?? 60000;
    this.minCandidates = config.minCandidates ?? 3;
    this.selectedMax = config.selectedMax ?? 3;
    this.situationMaxLen = config.situationMaxLen ?? 800;

    // 选出的关键帧集与各自的退避计时;初值为负无穷使首次调用必过退避门。
    this.selected = [];
    this._lastSelectAt = -Infinity;
    this._lastSituationAt = -Infinity;
    this._situationInterval = this.situationBaseIntervalMs;
  }
  //// /构造注入大模型客户端、关键帧缓冲、提示词与退避配置 ////

  //// 到退避区间且候选够数时,经大模型从缓冲选代表关键帧并并入选集 [@busybee 2026-06-13] ////
  async selectKeyframes() {
    const now = this.now();
    if (now - this._lastSelectAt < this.selectIntervalMs) return this.selected;
    const candidates = await this.buffer.sample();
    if (candidates.length < this.minCandidates) return this.selected;

    this._lastSelectAt = now;
    try {
      const userContent = this._buildSelectionContent(candidates);
      const result = await this.llmClient.complete({
        // 关键帧选择步:交模型路由按 keyframeSelect 步配置(vlm 大类)
        step: StepId.KeyframeSelect,
        messages: [
          { role: 'system', content: this.prompts.select || '' },
          { role: 'user', content: userContent }
        ]
      });
      const indices = parseFrameIndices(result.text, candidates.length);
      for (const idx of indices) {
        this.selected.push(candidates[idx]);
      }
      while (this.selected.length > this.selectedMax) {
        this.selected.shift();
      }
    } catch {
      // 选帧失败不抛出:它是感知器自己的事,不进角色反应链。
    }
    return this.selected;
  }
  //// /到退避区间且候选够数时,经大模型从缓冲选代表关键帧并并入选集 ////

  //// 把候选帧组装成「逐帧文本加图像」的用户内容 [@busybee 2026-06-13] ////
  _buildSelectionContent(candidates) {
    const content = [];
    for (let i = 0; i < candidates.length; i++) {
      const c = candidates[i];
      content.push({ type: 'text', text: `Frame ${i}: ${c.title || ''}` });
      content.push({
        type: 'image_url',
        image_url: { url: 'data:image/jpeg;base64,' + c.image }
      });
    }
    return content;
  }

  //// 对一帧抽桌面态势摘要:受退避区间约束,产出态势文本或 null [@busybee 2026-06-13] ////
  async extract(frame, background) {
    if (!frame || frame.image == null) return null;
    const now = this.now();
    if (now - this._lastSituationAt < this._situationInterval) return null;

    try {
      let userText = `Window: ${frame.title || ''}`;
      if (background) userText += `\nBackground:\n${background}`;
      const result = await this.llmClient.complete({
        // 态势抽取步:交模型路由按 situationExtract 步配置(vlm 大类)
        step: StepId.SituationExtract,
        messages: [
          { role: 'system', content: this.prompts.situation || '' },
          {
            role: 'user',
            content: [
              { type: 'text', text: userText },
              {
                type: 'image_url',
                image_url: { url: 'data:image/jpeg;base64,' + frame.image }
              }
            ]
          }
        ]
      });
      const situation = result.text ? result.text.trim().slice(0, this.situationMaxLen) : '';
      // 成功后退避翻倍到上限。
      this._situationInterval = Math.min(this._situationInterval * 2, this.situationMaxIntervalMs);
      this._lastSituationAt = now;
      return situation || null;
    } catch {
      this._situationInterval = Math.min(this._situationInterval * 2, this.situationMaxIntervalMs);
      this._lastSituationAt = now;
      return null;
    }
  }
  //// /对一帧抽桌面态势摘要 ////

  //// 返回当前选出的关键帧集,最新在前 [@busybee 2026-06-13] ////
  keyframes() {
    return this.selected.slice().reverse();
  }
}

module.exports = { VlmExtractor };
