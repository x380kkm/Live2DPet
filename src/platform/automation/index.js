// audience: internal
// # automation
// 自动化操纵通道装配:在回环套接字上接控制器与行协议,订阅关键领域事件转发到连接,供打包版无人实测驱动。
// 不变量:仅在组合根显式开启时挂载;只监听回环地址;选中的端口经 announce 回报(标准输出在打包 GUI 里可写,
//        但其标准输入不可靠,故命令走套接字);转发载荷只留纯数据摘要;第三方流经行协议进入,本文件只做接线。

const net = require('net');
const { AutomationController } = require('./automation-controller');
const { LineChannel } = require('./line-channel');
const { snapshotWindows } = require('./window-snapshot');

// 转发到连接的领域事件:产物、发言收尾、选定情绪、mod 挂载,供测试断言链路打通。
const FORWARDED_EVENTS = ['UtteranceProduced', 'UtteranceEnded', 'EmotionSelected', 'ModMountRequested'];
// 支持的操作名,随就绪事件回报给驱动方。
const SUPPORTED_OPS = ['ping', 'schedule-tick', 'inject-interaction', 'fetch-recent-reply', 'trigger-tts', 'list-windows'];

//// 把领域事件压成可安全行化的纯数据摘要:剥掉音频缓冲等大字段 [@x380kkm 2026-06-14] ////
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

//// 装配自动化通道:回环套接字接控制器,关键事件转发到连接,返回可停的句柄 [@x380kkm 2026-06-14] ////
// deps:{ caps(注入控制器的能力), eventBus, host?, announce(端口回报), log }。
function mountAutomation(deps) {
  const { caps, eventBus, host = '127.0.0.1', announce, log } = deps || {};
  const controller = new AutomationController(caps || {});
  // 当前已连上的行协议通道集合,领域事件向其全体转发。
  const channels = new Set();

  const server = net.createServer((socket) => {
    const channel = new LineChannel({ input: socket, output: socket, handle: (command) => controller.handle(command) });
    channel.start();
    channels.add(channel);
    channel.send({ event: 'automation-ready', payload: { ops: SUPPORTED_OPS } });
    const drop = () => { channel.stop(); channels.delete(channel); };
    socket.on('close', drop);
    socket.on('error', drop);
  });

  const unsubs = [];
  if (eventBus && typeof eventBus.subscribe === 'function') {
    for (const name of FORWARDED_EVENTS) {
      const unsub = eventBus.subscribe(name, (event) => {
        const line = { event: name, payload: summarize(event) };
        for (const channel of channels) {
          channel.send(line);
        }
      });
      if (typeof unsub === 'function') {
        unsubs.push(unsub);
      }
    }
  }

  server.listen(0, host, () => {
    const port = server.address().port;
    if (typeof announce === 'function') {
      announce({ port });
    }
    if (typeof log === 'function') {
      log(`[automation] 自动化操纵通道监听 ${host}:${port}`);
    }
  });

  return {
    server,
    controller,
    stop() {
      for (const channel of channels) {
        channel.stop();
      }
      unsubs.forEach((unsub) => unsub());
      server.close();
    }
  };
}
//// /装配自动化通道 ////

module.exports = { mountAutomation, snapshotWindows, summarize, FORWARDED_EVENTS, SUPPORTED_OPS };
