// audience: internal
// # repository
// 仓储接口定义:键值与时间分层查询,调用方只依赖它。
// 不变量:调用方只见此接口,具体存储后端不越过实现文件。
//
// 这是抽象基类:每个方法定义契约并要求子类覆写,本类自身不落盘。
// queryByTime 的 range 形如 { from, to, field },按记录的时间字段筛选区间内的项。

const NOT_OVERRIDDEN = '子类必须覆写此方法';

class Repository {
  //// 按键取值:命中返回值,未命中返回 null [@x380kkm 2026-06-13] ////
  get(key) {
    throw new Error(NOT_OVERRIDDEN);
  }

  //// 按键存值:覆盖式写入 [@x380kkm 2026-06-13] ////
  put(key, value) {
    throw new Error(NOT_OVERRIDDEN);
  }

  //// 按时间区间查记录:返回时间字段落在 [from, to] 内的项 [@x380kkm 2026-06-13] ////
  queryByTime(range) {
    throw new Error(NOT_OVERRIDDEN);
  }
}

module.exports = { Repository };
