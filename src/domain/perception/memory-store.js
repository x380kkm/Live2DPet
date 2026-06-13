// audience: internal
// # memory-store
// 短期与中期记忆:经 storage 仓储做时间分层查询与写入。
// 不变量:生命周期由 pet 显式 load 与 flush 驱动,记忆不自行落盘。

const UNIMPLEMENTED = '未实现,见目标架构设计第七节迁移里程碑';

class MemoryStore {
  // 经仓储加载已有记忆
  load() {
    throw new Error(UNIMPLEMENTED);
  }

  // 写入一条记忆
  append(entry) {
    throw new Error(UNIMPLEMENTED);
  }

  // 按时间窗读取记忆
  recall(window) {
    throw new Error(UNIMPLEMENTED);
  }

  // 经仓储落盘
  flush() {
    throw new Error(UNIMPLEMENTED);
  }
}

module.exports = { MemoryStore };
