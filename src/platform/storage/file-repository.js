// audience: internal
// # file-repository
// 仓储接口的文件实现:异步 I/O,经 path-utils 算路径。
// 不变量:本文件只经 path-utils 取路径,不内联路径字面量。
//
// 构造注入 pathUtils(算路径)与 fs(promises 形态:readFile/writeFile/access/mkdir)。
// 每个 key 落成用户数据目录下一个 JSON 文件;值可为任意可序列化数据。
// 时间分层查询的对象是某个 key 下的记录集合:range.field 指定记录里的时间字段,
// range.from/range.to 为闭区间边界,返回该字段落在区间内的记录列表。

const { Repository } = require('./repository');

//// 把存储键转成 JSON 文件名:统一加扩展名 [@x380kkm 2026-06-13] ////
function toFileName(key) {
  return key.endsWith('.json') ? key : `${key}.json`;
}

//// 把记录集合摊平成数组:对象取其值,数组原样返回 [@x380kkm 2026-06-13] ////
function toEntries(collection) {
  if (Array.isArray(collection)) return collection;
  if (collection && typeof collection === 'object') return Object.values(collection);
  return [];
}

class FileRepository extends Repository {
  constructor(pathUtils, fs) {
    super();
    this.pathUtils = pathUtils;
    this.fs = fs;
  }

  //// 读 JSON 文件并解析:文件不存在或解析失败返回 null [@x380kkm 2026-06-13] ////
  async get(key) {
    const filePath = this.pathUtils.resolve(toFileName(key));
    try {
      const raw = await this.fs.readFile(filePath, 'utf-8');
      return JSON.parse(raw);
    } catch (e) {
      return null;
    }
  }

  //// 序列化并覆盖写入 JSON 文件:先建好父目录 [@x380kkm 2026-06-13] ////
  async put(key, value) {
    const filePath = this.pathUtils.resolve(toFileName(key));
    const dir = filePath.slice(0, Math.max(filePath.lastIndexOf('/'), filePath.lastIndexOf('\\')));
    if (dir) await this.fs.mkdir(dir, { recursive: true });
    await this.fs.writeFile(filePath, JSON.stringify(value, null, 2), 'utf-8');
  }
  //// /序列化并覆盖写入 JSON 文件 ////

  //// 按时间区间筛 key 下的记录:取 field 字段落在 [from, to] 内的项 [@x380kkm 2026-06-13] ////
  async queryByTime(range) {
    const collection = await this.get(range.key);
    if (collection === null) return [];
    const field = range.field;
    const from = range.from;
    const to = range.to;
    const result = [];
    for (const entry of toEntries(collection)) {
      const at = entry && entry[field];
      if (at === undefined || at === null) continue;
      if (at >= from && at <= to) result.push(entry);
    }
    return result;
  }
  //// /按时间区间筛 key 下的记录 ////
}

module.exports = { FileRepository };
