// audience: internal
// # automation
// 自动化操纵通道装配:把控制器接到标准输入输出行协议,订阅关键领域事件转发到输出,供打包版无人实测驱动。
// 不变量:仅在组合根显式开启时挂载;第三方流与窗口经各自包装进入,本文件只做接线;转发载荷只留纯数据摘要。

const { AutomationController } = require('./automation-controller');
const { StdioChannel } = require('./stdio-channel');
const { snapshotWindows } = require('./window-snapshot');

// 转发到输出的领域事件:产物、发言收尾、选定情绪、mod 挂载,供测试断言链路打通。
const FORWARDED_EVENTS = ['UtteranceProduced', 'UtteranceEnded', 'EmotionSelected', 'ModMountRequested'];
// 支持的操作名,随就绪事件回报给驱动方。
const SUPPORTED_OPS = ['ping', 'schedule-tick', 'inject-interaction', 'fetch-recent-reply', 'trigger-tts', 'list-windows'];

//// 把领域事件压成可安全行化的纯数据摘要:剥掉音频缓冲等大字段 [@busybee 2026-06-14] ////
function summarize(event) {
  if (!event || typeof event !== 'object') {
    return event;
  }
  const out = {};
  for (const key of ['type', 'intentId', 'name', 'modId', 'text', 'hasAudio', 'bubbleDurationMs']) {
    if (event[key] !== undefined) {
      out[key] = event[key];
    }
  }
  if (event.utterance && event.utterance.text) {
    out.text = event.utterance.text;
  }
  return out;
}
//// /把领域事件压成纯数据摘要 ////

//// 装配自动化通道:控制器接行协议,关键事件转发到输出,返回可停的句柄 [@busybee 2026-06-14] ////
// deps:{ caps(注入控制器的能力), eventBus, input, output, log }。
function mountAutomation(deps) {
  const { caps, eventBus, input, output, log } = deps || {};
  const controller = new AutomationController(caps || {});
  const channel = new StdioChannel({ input, output, handle: (command) => controller.handle(command) });

  const unsubs = [];
  if (eventBus && typeof eventBus.subscribe === 'function') {
    for (const name of FORWARDED_EVENTS) {
      const unsub = eventBus.subscribe(name, (event) => channel.send({ event: name, payload: summarize(event) }));
      if (typeof unsub === 'function') {
        unsubs.push(unsub);
      }
    }
  }

  channel.start();
  channel.send({ event: 'automation-ready', payload: { ops: SUPPORTED_OPS } });
  if (typeof log === 'function') {
    log('[automation] 自动化操纵通道已开启');
  }

  return {
    channel,
    controller,
    stop() {
      channel.stop();
      unsubs.forEach((unsub) => unsub());
    }
  };
}
//// /装配自动化通道 ////

module.exports = { mountAutomation, snapshotWindows, summarize, FORWARDED_EVENTS, SUPPORTED_OPS };
