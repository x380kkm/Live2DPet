// audience: internal
// # ipc-router
// 主进程侧统一注册与分发进程间通信,收敛 try/catch 与存活判断样板。
// 不变量:通道名只来自 channel-registry,本文件不写裸字符串。

const registry = require('./channel-registry');

//// 持有已注册处理器,按通道名查 [@busybee 2026-06-13] ////
const handlers = new Map();

//// 把一个未知或抛错的结果归一成调用方可判定的失败对象 [@busybee 2026-06-13] ////
function toFailure(error) {
  return { success: false, error: error && error.message ? error.message : String(error) };
}

//// 校验通道名属于契约目录,再登记处理器,重复登记同名通道报错 [@busybee 2026-06-13] ////
function register(channelName, handler) {
  if (!registry.isKnown(channelName)) {
    throw new Error(`未声明的通道:${channelName}`);
  }
  if (typeof handler !== 'function') {
    throw new Error(`通道 ${channelName} 的处理器不是函数`);
  }
  if (handlers.has(channelName)) {
    throw new Error(`通道 ${channelName} 已注册`);
  }
  handlers.set(channelName, handler);
}

//// 按通道名取处理器并调用,收敛 try/catch:未注册或抛错都归一成失败对象 [@busybee 2026-06-13] ////
async function dispatch(channelName, payload) {
  const handler = handlers.get(channelName);
  if (!handler) {
    return toFailure(new Error(`通道 ${channelName} 未注册`));
  }
  try {
    return await handler(payload);
  } catch (error) {
    return toFailure(error);
  }
}

//// 判断一个通道是否已登记处理器,供组合根补齐剩余通道时避开重复注册 [@busybee 2026-06-13] ////
function isRegistered(channelName) {
  return handlers.has(channelName);
}

//// 判断一个目标窗口仍存活,集中替代各转发处逐字重复的存活判断 [@busybee 2026-06-13] ////
function isAlive(target) {
  return !!target && typeof target.isDestroyed === 'function' && !target.isDestroyed();
}

//// 清空已注册处理器,供测试在用例间复位 [@busybee 2026-06-13] ////
function reset() {
  handlers.clear();
}

module.exports = { register, dispatch, isAlive, isRegistered, reset };
