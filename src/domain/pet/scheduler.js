// audience: internal
// # scheduler
// 主循环调度器:按可配间隔周期性驱动一轮角色编排——采感知、取候选、选意图、跑意图,并按需喂情绪。
// 不变量:不持窗口句柄、不碰第三方类型;计时与时钟经构造注入,start/stop 干净不残留定时器。
//
// 依赖经构造注入:
//   perception   感知采集源,capture() 返回一帧 { image, title, ... } 或 null,屏蔽截屏与窗口取用细节
//   collector    PerceptionCollector,tick(frame, background) 投帧选帧抽态势,返回态势文本或 null
//   registry     IntentRegistry,candidates(scope) 列出当前信号能触发的候选意图
//   pet          PetOrchestrator,selectIntent(candidates, scope) 选一个、run(intent, scope) 跑出回应
//   emotionState 可选 EmotionState,每拍喂 tick、产出回应时喂 reply,到阈值由其自行发事件
//   clock        注入时钟,now() 返回毫秒时间戳
//   timer        注入计时接口,setInterval/clearInterval 与全局同形

// 调度间隔下限:最小 10 秒,防止过密驱动模型。
const MIN_INTERVAL_MS = 10000;

class PetScheduler {
  //// 构造注入感知、采集、意图、编排、情绪、时钟与计时接口及可配间隔 [@busybee 2026-06-13] ////
  // config.intervalMs 为驱动周期;config.chatGapMs 为两次产出回应之间的最小间隔;两者都下限到 10 秒。
  constructor(deps = {}, config = {}) {
    this.perception = deps.perception;
    this.collector = deps.collector;
    this.registry = deps.registry;
    this.pet = deps.pet;
    this.emotionState = deps.emotionState || null;
    this.clock = deps.clock || { now: () => Date.now() };
    this.timer = deps.timer || { setInterval, clearInterval };

    this.intervalMs = clampInterval(config.intervalMs);
    this.chatGapMs = clampInterval(config.chatGapMs);

    // 当前周期定时器句柄,未运行时为 null。
    this._handle = null;
    // 上一拍是否仍在跑,避免上一轮异步未完时重入。
    this._running = false;
    // 上次产出回应的时间戳,据此守 chatGap 间隔。
    this._lastReplyAt = 0;
  }
  //// /构造注入感知、采集、意图、编排、情绪、时钟与计时接口及可配间隔 ////

  //// 启动周期驱动:按 intervalMs 反复跑一轮,重复启动无副作用 [@busybee 2026-06-13] ////
  start() {
    if (this._handle) {
      return;
    }
    this._handle = this.timer.setInterval(() => this._driveOnce(), this.intervalMs);
  }
  //// /启动周期驱动 ////

  //// 停止周期驱动:清掉定时器并复位句柄,重复停止无副作用 [@busybee 2026-06-13] ////
  stop() {
    if (!this._handle) {
      return;
    }
    this.timer.clearInterval(this._handle);
    this._handle = null;
  }
  //// /停止周期驱动 ////

  //// 跑一轮:采感知、组装作用域、取候选、选意图、跑意图,并按需喂情绪 [@busybee 2026-06-13] ////
  // 上一拍未跑完则跳过本拍,避免重入;全程不向计时器抛错,单拍失败不拖垮后续周期。
  async _driveOnce() {
    if (this._running) {
      return;
    }
    this._running = true;
    try {
      const situation = await this._perceive();
      this._feedTick();

      const scope = this._buildScope(situation);
      const candidates = this.registry.candidates(scope);
      const intent = await this.pet.selectIntent(candidates, scope);
      if (!intent) {
        return;
      }

      const response = await this.pet.run(intent, scope);
      this._afterRun(response);
    } catch (error) {
      // 单拍失败只记录,不抛回计时器,让下一拍照常进行。
      logTickError(error);
    } finally {
      this._running = false;
    }
  }
  //// /跑一轮 ////

  //// 采一帧交采集源跑退避采集,返回本拍态势文本或 null [@busybee 2026-06-13] ////
  // 无感知源或无采集源时返回 null,作用域据此落为空闲态势。
  async _perceive() {
    if (!this.perception || typeof this.perception.capture !== 'function') {
      return null;
    }
    const frame = await this.perception.capture();
    if (!frame || !this.collector) {
      return null;
    }
    return this.collector.tick(frame, frame.background || null);
  }

  //// 据本拍态势组装作用域:有态势即有视觉输入,态势文本作摘要交选意图用 [@busybee 2026-06-13] ////
  // signals 供意图注册表按触发条件筛候选;situationDigest 供选意图请求陈述当前态势。
  _buildScope(situation) {
    return {
      signals: { hasVisualInput: Boolean(situation), modEvents: [] },
      situationDigest: situation || ''
    };
  }

  //// 每拍给情绪状态喂一拍输入,推进积累 [@busybee 2026-06-13] ////
  _feedTick() {
    if (this.emotionState && typeof this.emotionState.feed === 'function') {
      this.emotionState.feed({ kind: 'tick' });
    }
  }

  //// 跑出回应后记录产出时刻并按文本长度给情绪一次性加成 [@busybee 2026-06-13] ////
  // 守 chatGap:距上次产出不足间隔时不喂回复加成,避免短时间连发拉高积累。
  _afterRun(response) {
    if (!response || !response.text) {
      return;
    }
    const now = this.clock.now();
    if (now - this._lastReplyAt < this.chatGapMs) {
      return;
    }
    this._lastReplyAt = now;
    if (this.emotionState && typeof this.emotionState.feed === 'function') {
      this.emotionState.feed({ kind: 'reply', length: response.text.length });
    }
  }
}

//// 把可配间隔下限到最小 10 秒,非数或过小一律取下限 [@busybee 2026-06-13] ////
function clampInterval(ms) {
  if (typeof ms !== 'number' || !Number.isFinite(ms)) {
    return MIN_INTERVAL_MS;
  }
  return Math.max(MIN_INTERVAL_MS, ms);
}
//// /把可配间隔下限到最小 10 秒 ////

//// 单拍失败时记录错误,有 console 才打,无则静默吞掉 [@busybee 2026-06-13] ////
function logTickError(error) {
  if (typeof console !== 'undefined' && typeof console.error === 'function') {
    console.error('[PetScheduler] 单拍驱动失败:', error && error.message ? error.message : error);
  }
}
//// /单拍失败时记录错误 ////

module.exports = { PetScheduler, MIN_INTERVAL_MS };
