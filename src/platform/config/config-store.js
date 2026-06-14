// audience: internal
// # config-store
// 配置持久化适配:经 storage 仓储读写,字段加密只声明一处。
// 不变量:配置只经 storage 仓储落盘,本文件不直接碰文件系统。

// 加密字段路径只声明一处:全部用点分路径定位到一层配置内的字符串值。
// 含单接入的 apiKey 与翻译接入,以及两层模型配置里三个大类各自的接入密钥。
const ENCRYPTED_FIELDS = [
  'apiKey', 'translation.apiKey', 'enhance.search.customApiKey',
  'modelConfig.categories.vlm.apiKey',
  'modelConfig.categories.llm.apiKey',
  'modelConfig.categories.translate.apiKey'
];

const LAYERS = ['global', 'character', 'intent'];

//// 按点分路径取一个嵌套字段,缺失返回 undefined [@busybee 2026-06-13] ////
function getPath(obj, dotted) {
  const parts = dotted.split('.');
  let cursor = obj;
  for (const part of parts) {
    if (cursor == null || typeof cursor !== 'object') return undefined;
    cursor = cursor[part];
  }
  return cursor;
}

//// 按点分路径写一个嵌套字段,中途缺失的对象就地补建 [@busybee 2026-06-13] ////
function setPath(obj, dotted, value) {
  const parts = dotted.split('.');
  let cursor = obj;
  for (let i = 0; i < parts.length - 1; i++) {
    const part = parts[i];
    if (cursor[part] == null || typeof cursor[part] !== 'object') cursor[part] = {};
    cursor = cursor[part];
  }
  cursor[parts[parts.length - 1]] = value;
}

//// 把一层、一个作用域 id 映射成仓储里的存储键 [@busybee 2026-06-13] ////
function storageKey(layer, scopeId) {
  if (!LAYERS.includes(layer)) throw new Error(`未知配置层:${layer}`);
  // 全局层只有一份,忽略 scopeId;角色层与意图层按 id 分桶。
  if (layer === 'global') return 'config/global';
  return `config/${layer}/${scopeId}`;
}

class ConfigStore {
  //// 构造注入仓储与加解密函数,第三方类型不进本层 [@busybee 2026-06-13] ////
  constructor(repository, options = {}) {
    this.repository = repository;
    // 加解密由调用方注入,默认两者透传。
    this.encrypt = options.encrypt || ((v) => v);
    this.decrypt = options.decrypt || ((v) => v);
  }

  //// 读一层配置并就地解密声明过的字段 [@busybee 2026-06-13] ////
  async read(layer, scopeId) {
    const stored = await this.repository.get(storageKey(layer, scopeId));
    if (stored == null) return null;
    // 先深拷贝再就地解密。
    const value = JSON.parse(JSON.stringify(stored));
    this._decryptFields(value);
    return value;
  }

  //// 加密声明过的字段后写一层配置 [@busybee 2026-06-13] ////
  async write(layer, scopeId, value) {
    const toStore = JSON.parse(JSON.stringify(value));
    this._encryptFields(toStore);
    await this.repository.put(storageKey(layer, scopeId), toStore);
  }

  //// 把声明过的字段逐个解密 [@busybee 2026-06-13] ////
  _decryptFields(value) {
    for (const field of ENCRYPTED_FIELDS) {
      const current = getPath(value, field);
      if (current) setPath(value, field, this.decrypt(current));
    }
  }

  //// 把声明过的字段逐个加密 [@busybee 2026-06-13] ////
  _encryptFields(value) {
    for (const field of ENCRYPTED_FIELDS) {
      const current = getPath(value, field);
      if (current) setPath(value, field, this.encrypt(current));
    }
  }
}

module.exports = { ConfigStore, ENCRYPTED_FIELDS };
