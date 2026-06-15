// audience: internal
// # memory-store
// 短期与中期记忆:经 storage 仓储做时间分层查询与写入。
// 不变量:生命周期由 pet 显式 load 与 flush 驱动,记忆不自行落盘。
//
// 依赖经构造注入:repository 提供 get/put/queryByTime;now 为注入时钟。
// 记忆条目形如 { situation, title, timestamp };短期是本会话内存缓冲,中期是仓储里的时间分层集合。
// load 把仓储里的中期记忆读进内存,append 只写内存缓冲,recall 合并两段按时间窗筛,
// flush 把内存缓冲并入仓储并按保留期淘汰过旧条目。仓储键经构造给定,默认 perception-memory。

class MemoryStore {
  //// 构造注入仓储、时钟与配置,装配空的短期缓冲 [@x380kkm 2026-06-13] ////
  constructor(deps = {}, config = {}) {
    this.repository = deps.repository;
    this.now = deps.now || (() => Date.now());

    this.storageKey = config.storageKey || 'perception-memory';
    this.retentionMs = config.retentionMs ?? 7 * 86400000;
    this.maxEntries = config.maxEntries ?? 200;

    // 短期:本会话写入、尚未落盘的条目。
    this.shortTerm = [];
    // 中期:从仓储读进的已落盘条目。
    this.midTerm = [];
  }
  //// /构造注入仓储、时钟与配置 ////

  //// 经仓储加载已有中期记忆进内存 [@x380kkm 2026-06-13] ////
  async load() {
    const stored = await this.repository.get(this.storageKey);
    this.midTerm = Array.isArray(stored) ? stored : [];
  }
  //// /经仓储加载已有中期记忆进内存 ////

  //// 写入一条记忆到短期缓冲:补全时间戳,不落盘 [@x380kkm 2026-06-13] ////
  append(entry) {
    if (!entry) return;
    const stamped = {
      ...entry,
      timestamp: entry.timestamp != null ? entry.timestamp : this.now()
    };
    this.shortTerm.push(stamped);
  }
  //// /写入一条记忆到短期缓冲 ////

  //// 按时间窗读取记忆:合并中期与短期,筛时间戳落在 [from, to] 内的项,最新在前 [@x380kkm 2026-06-13] ////
  recall(window = {}) {
    const from = window.from != null ? window.from : -Infinity;
    const to = window.to != null ? window.to : Infinity;
    const all = this.midTerm.concat(this.shortTerm);
    const hits = all.filter((e) => e.timestamp >= from && e.timestamp <= to);
    hits.sort((a, b) => b.timestamp - a.timestamp);
    return window.limit != null ? hits.slice(0, window.limit) : hits;
  }
  //// /按时间窗读取记忆 ////

  //// 经仓储落盘:短期并入中期、淘汰过旧与超额条目、写回仓储、清空短期 [@x380kkm 2026-06-13] ////
  async flush() {
    if (this.shortTerm.length === 0) return;
    const merged = this.midTerm.concat(this.shortTerm);
    this.midTerm = this._prune(merged);
    await this.repository.put(this.storageKey, this.midTerm);
    this.shortTerm = [];
  }
  //// /经仓储落盘 ////

  //// 淘汰超保留期的条目,再按时间保留最近 maxEntries 条 [@x380kkm 2026-06-13] ////
  _prune(entries) {
    const cutoff = this.now() - this.retentionMs;
    const fresh = entries.filter((e) => e.timestamp >= cutoff);
    fresh.sort((a, b) => b.timestamp - a.timestamp);
    return fresh.slice(0, this.maxEntries);
  }
}

module.exports = { MemoryStore };
