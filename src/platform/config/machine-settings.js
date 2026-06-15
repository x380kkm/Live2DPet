// audience: internal
// # machine-settings
// 用户级全局设置(模型接入、界面语言),与角色表现参数分开。
// 不变量:本文件只承载全局层键,角色表现参数不进此处。

const { KEY_FLOOR } = require('./layered-config');

// 全局层键集合:从键声明表里筛出 floor 为 global 的键,作为本文件唯一收纳范围。
const GLOBAL_KEYS = new Set(
  Object.keys(KEY_FLOOR).filter((key) => KEY_FLOOR[key] === 'global')
);

class MachineSettings {
  //// 构造注入 config-store 与全局层当前快照 [@x380kkm 2026-06-13] ////
  constructor(configStore, snapshot = {}) {
    this.configStore = configStore;
    this.values = { ...snapshot };
  }

  //// 从 config-store 读全局层并装配一份设置实例 [@x380kkm 2026-06-13] ////
  static async load(configStore) {
    const snapshot = await configStore.read('global');
    return new MachineSettings(configStore, snapshot || {});
  }

  //// 取一个全局设置,非全局层键直接拒绝 [@x380kkm 2026-06-13] ////
  get(key) {
    assertGlobalKey(key);
    return this.values[key];
  }

  //// 写一个全局设置并经 config-store 落盘 [@x380kkm 2026-06-13] ////
  async set(key, value) {
    assertGlobalKey(key);
    this.values[key] = value;
    await this.configStore.write('global', null, this.values);
  }
}

//// 校验键属于全局层,否则报清晰错误 [@x380kkm 2026-06-13] ////
function assertGlobalKey(key) {
  if (!GLOBAL_KEYS.has(key)) {
    throw new Error(`键 ${key} 不是全局层键,不能进 machine-settings`);
  }
}

module.exports = { MachineSettings, GLOBAL_KEYS };
