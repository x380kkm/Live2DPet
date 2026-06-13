// audience: internal
// # perception-collector
// 感知采集连接件:每拍把一帧投入关键帧缓冲,驱动 vlm-extractor 的退避采集,把抽出的态势写入记忆。
// 不变量:采集节奏的退避门在 extractor 内,连接件每拍直调、不自带计时;采集失败不抛进角色反应链。
//
// 依赖经构造注入:buffer.push(frame) 收帧;extractor.selectKeyframes() 与 extractor.extract(frame, bg)
// 各受自身退避区间约束;extractor.keyframes() 给出最新在前的选集;memoryStore.append(entry) 落记忆短期缓冲。
// tick(frame, background) 是采集源每次拿到新帧时调一次:投帧、选关键帧、抽态势、写记忆。

class PerceptionCollector {
  //// 构造注入关键帧缓冲、态势抽取器与记忆库 [@busybee 2026-06-13] ////
  constructor(deps = {}) {
    this.buffer = deps.buffer;
    this.extractor = deps.extractor;
    this.memoryStore = deps.memoryStore;
  }
  //// /构造注入关键帧缓冲、态势抽取器与记忆库 ////

  //// 收一帧,跑一轮退避采集:投帧、选关键帧、对最新关键帧抽态势并落记忆 [@busybee 2026-06-13] ////
  // 退避门在 extractor 内,本方法每帧直调;选帧与抽态势的实际频率由其退避区间裁定。
  // 抽出非空态势时返回该态势文本并写入记忆,否则返回 null;全程不向调用方抛错。
  async tick(frame, background) {
    if (!frame || frame.image == null) {
      return null;
    }

    await this.buffer.push(frame);
    await this.extractor.selectKeyframes();

    const target = this._latestKeyframe() || frame;
    const situation = await this.extractor.extract(target, background);
    if (!situation) {
      return null;
    }

    this._remember(situation, target.title);
    return situation;
  }
  //// /收一帧,跑一轮退避采集 ////

  //// 取抽取器选出的最新关键帧,无则返回 null [@busybee 2026-06-13] ////
  _latestKeyframe() {
    if (!this.extractor || typeof this.extractor.keyframes !== 'function') {
      return null;
    }
    const frames = this.extractor.keyframes();
    return frames && frames.length > 0 ? frames[0] : null;
  }

  //// 把一条态势摘要连同窗口标题写入记忆短期缓冲 [@busybee 2026-06-13] ////
  _remember(situation, title) {
    if (!this.memoryStore || typeof this.memoryStore.append !== 'function') {
      return;
    }
    this.memoryStore.append({ situation, title });
  }
}

module.exports = { PerceptionCollector };
