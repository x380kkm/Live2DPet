// audience: internal
// # perception-source
// 感知作为上下文源接入请求管线:屏蔽采集细节,只产出命名的上下文片段。
// 不变量:感知器不直接拼提示词,产物以命名上下文源经注册表登记;采集节奏与角色反应链相互独立。
//
// 依赖经构造注入:extractor 给出最近态势摘要;memoryStore 给出近窗记忆;
// now 为注入时钟。render 把态势与记忆折成一份 ContextFragment 纯数据,
// 无内容时返回 null 由组装器跳过;estimateTokens 据字符数粗估,组装器按预算裁剪用。

//// 粗估字符串的 token 数:按约四字符一 token 取上整 [@busybee 2026-06-13] ////
function estimateTextTokens(text) {
  if (!text) return 0;
  return Math.ceil(text.length / 4);
}
//// /粗估字符串的 token 数 ////

class PerceptionSource {
  // 上下文源标识
  id = 'perception';
  // 排序优先级
  priority = 0;

  //// 构造注入态势抽取器、记忆库、时钟与配置 [@busybee 2026-06-13] ////
  constructor(deps = {}, config = {}) {
    this.extractor = deps.extractor;
    this.memoryStore = deps.memoryStore;
    this.now = deps.now || (() => Date.now());

    if (config.id) this.id = config.id;
    if (config.priority != null) this.priority = config.priority;
    // 记忆回看窗与最多并入的近期记忆条数。
    this.recallWindowMs = config.recallWindowMs ?? 600000;
    this.recallLimit = config.recallLimit ?? 3;
  }
  //// /构造注入态势抽取器、记忆库、时钟与配置 ////

  //// 据当前渲染出的片段文本粗估 token 数 [@busybee 2026-06-13] ////
  estimateTokens(scope) {
    const fragment = this.render(scope);
    return fragment ? estimateTextTokens(fragment.text) : 0;
  }
  //// /据当前渲染出的片段文本粗估 token 数 ////

  //// 把最近态势与近窗记忆折成命名上下文片段;两者皆空返回 null [@busybee 2026-06-13] ////
  render(scope) {
    const lines = [];

    const situation = this._latestSituation();
    if (situation) lines.push(situation);

    const recalled = this._recentMemory();
    for (const entry of recalled) {
      if (entry.situation) lines.push(entry.situation);
    }

    if (lines.length === 0) return null;
    return { sourceId: this.id, text: lines.join('\n') };
  }
  //// /把最近态势与近窗记忆折成命名上下文片段 ////

  //// 取抽取器选出的最新关键帧的态势摘要,无则取空 [@busybee 2026-06-13] ////
  _latestSituation() {
    if (!this.extractor || typeof this.extractor.keyframes !== 'function') return null;
    const frames = this.extractor.keyframes();
    const latest = frames[0];
    return latest ? latest.situation : null;
  }

  //// 经记忆库按回看窗读最近若干条记忆 [@busybee 2026-06-13] ////
  _recentMemory() {
    if (!this.memoryStore || typeof this.memoryStore.recall !== 'function') return [];
    const to = this.now();
    return this.memoryStore.recall({ from: to - this.recallWindowMs, to, limit: this.recallLimit });
  }
}

module.exports = { PerceptionSource };
