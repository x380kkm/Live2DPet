// audience: internal
// # mod-source
// mod 规格的文件源:从若干目录读 JSON 规格,同步列出供领域层注册表发现。
// 不变量:信任级别由来源目录强制决定而非取文件自报,用户 mod 不能冒充出厂;读不到的目录或解析失败的文件跳过、不抛。
// 第三方 fs 与 path 经构造注入,便于用内存假实现做单测,不在本文件直接 require。

//// 造 mod 文件源:按目录清单逐目录读 JSON 规格,合成 list() 同步返回的源 [@x380kkm 2026-06-14] ////
// deps 形如:
//   dirs  [{ dir, trust }] 目录与其信任级别;靠前目录先列出
//   fs    至少含 readdirSync(dir) 与 readFileSync(path, enc) 的文件读接口
//   path  至少含 join(...) 的路径拼接接口
function createModSource(deps) {
  const config = deps || {};
  const dirs = Array.isArray(config.dirs) ? config.dirs : [];
  const fs = config.fs;
  const path = config.path;

  function readDir(dir, trust) {
    let names;
    try { names = fs.readdirSync(dir); } catch { return []; }
    const specs = [];
    for (const name of names) {
      if (!name.endsWith('.json')) continue;
      let spec;
      try { spec = JSON.parse(fs.readFileSync(path.join(dir, name), 'utf-8')); } catch { continue; }
      if (!spec || typeof spec !== 'object') continue;
      // 信任级别由来源目录强制,覆盖文件自报值
      spec.trust = trust;
      if (!spec.id) spec.id = name.replace(/\.json$/, '');
      specs.push(spec);
    }
    return specs;
  }

  return {
    //// 逐目录列出已解析的 mod 规格,靠前目录在前,供 ModRegistry.discover 同步取用 [@x380kkm 2026-06-14] ////
    list() {
      const all = [];
      for (const entry of dirs) {
        if (entry && entry.dir) {
          all.push(...readDir(entry.dir, entry.trust));
        }
      }
      return all;
    }
  };
}
//// /造 mod 文件源 ////

module.exports = { createModSource };
