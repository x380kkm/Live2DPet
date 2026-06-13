// audience: internal
// # situationDigest-source
// 态势摘要上下文源:把感知抽取器选出的最新关键帧的桌面态势折成一行命名片段。
// 不变量:id 取意图引用名 situationDigest;只读态势文本不内联人格;无态势返回 null 由组装器跳过。
//
// 依赖经构造注入:extractor 暴露 keyframes() 返回最新在前的关键帧集,每帧含 situation 文本。
// 迁移自 PerceptionSource._latestSituation 与旧 desktop-pet-system 的 VLM 态势注入。

const { ContextSource, estimateTextTokens } = require('../context-source');

class SituationDigestSource extends ContextSource {
  //// 构造注入态势抽取器与可覆盖的标识、优先级、标签 [@busybee 2026-06-13] ////
  constructor(deps = {}, config = {}) {
    super();
    this.extractor = deps.extractor;
    this._id = config.id || 'situationDigest';
    this._priority = config.priority != null ? config.priority : 80;
    // label 作结构化前缀,缺省为空,成品措辞由解析期按角色注入。
    this.label = config.label || '';
    // 态势文本最长保留字符数,超出截断。
    this.maxLen = config.maxLen != null ? config.maxLen : 800;
  }
  //// /构造注入态势抽取器与可覆盖的标识、优先级、标签 ////

  get id() {
    return this._id;
  }

  get priority() {
    return this._priority;
  }

  estimateTokens(scope) {
    return estimateTextTokens(this.render(scope));
  }

  //// 取抽取器最新关键帧的态势,折成带标签的一行;无态势返回 null [@busybee 2026-06-13] ////
  render() {
    const situation = this._latestSituation();
    if (!situation) {
      return null;
    }
    const trimmed = situation.trim().slice(0, this.maxLen);
    if (!trimmed) {
      return null;
    }
    return this.label ? this.label + trimmed : trimmed;
  }
  //// /取抽取器最新关键帧的态势 ////

  //// 取抽取器选出的最新关键帧的态势摘要,缺数据时取空 [@busybee 2026-06-13] ////
  _latestSituation() {
    if (!this.extractor || typeof this.extractor.keyframes !== 'function') {
      return null;
    }
    const frames = this.extractor.keyframes();
    const latest = Array.isArray(frames) ? frames[0] : null;
    return latest && latest.situation ? latest.situation : null;
  }
}

module.exports = { SituationDigestSource };
