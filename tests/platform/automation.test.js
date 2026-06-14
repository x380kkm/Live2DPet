// audience: internal
// # automation.test
// 验证自动化操纵通道:控制器按操作派发并收敛错误、行协议逐行解析命令回结果、窗口快照折成纯数据、
// 装配在回环套接字上接受连接并把关键领域事件转发到连接。全程用内存流、回环套接字与替身,不起进程不起窗口。
// 运行: node --test tests/platform/automation.test.js

const { test } = require('node:test');
const assert = require('node:assert');
const net = require('node:net');
const { EventEmitter } = require('node:events');

const { AutomationController } = require('../../src/platform/automation/automation-controller');
const { LineChannel } = require('../../src/platform/automation/line-channel');
const { snapshotWindows } = require('../../src/platform/automation/window-snapshot');
const { mountAutomation, summarize } = require('../../src/platform/automation');
const { EventBus } = require('../../src/platform/bus/event-bus');

//// 内存可写流:把写入的字符串逐段收集,可按行取回 [@busybee 2026-06-14] ////
function memoryOutput() {
  const chunks = [];
  return {
    chunks,
    write(text) { chunks.push(text); return true; },
    lines() { return chunks.join('').split('\n').filter((l) => l.length > 0); }
  };
}

//// 控制器按操作派发到注入能力 [@busybee 2026-06-14] ////
test('控制器派发各操作并回结果', async () => {
  const log = [];
  const controller = new AutomationController({
    runTick: async () => { log.push('tick'); },
    injectInteraction: ({ name }) => log.push(`inject:${name}`),
    fetchRecentReplies: (count) => ['甲', '乙', '丙'].slice(-count),
    synthesize: async (text) => ({ hasAudio: true, bytes: text.length * 2 }),
    listWindows: () => [{ name: 'pet', alive: true }]
  });

  assert.deepStrictEqual((await controller.handle({ id: 1, op: 'ping' })), { id: 1, ok: true, result: { pong: true } });

  const tick = await controller.handle({ id: 2, op: 'schedule-tick' });
  assert.deepStrictEqual(tick, { id: 2, ok: true, result: { ticked: true } });
  assert.ok(log.includes('tick'));

  const inject = await controller.handle({ id: 3, op: 'inject-interaction', args: { name: 'click' } });
  assert.deepStrictEqual(inject.result, { injected: 'click' });
  assert.ok(log.includes('inject:click'));

  const replies = await controller.handle({ id: 4, op: 'fetch-recent-reply', args: { count: 2 } });
  assert.deepStrictEqual(replies.result, { replies: ['乙', '丙'] });

  const tts = await controller.handle({ id: 5, op: 'trigger-tts', args: { text: 'こんにちは' } });
  assert.strictEqual(tts.result.hasAudio, true);
  assert.strictEqual(tts.result.bytes, 'こんにちは'.length * 2);

  const windows = await controller.handle({ id: 6, op: 'list-windows' });
  assert.deepStrictEqual(windows.result.windows, [{ name: 'pet', alive: true }]);
});

//// 未知操作回错误结果不抛 [@busybee 2026-06-14] ////
test('控制器对未知操作回错误,对能力异常收敛成错误', async () => {
  const controller = new AutomationController({
    runTick: async () => { throw new Error('调度炸了'); }
  });

  const unknown = await controller.handle({ id: 1, op: '不存在' });
  assert.strictEqual(unknown.ok, false);
  assert.match(unknown.error, /未知操作/);

  const thrown = await controller.handle({ id: 2, op: 'schedule-tick' });
  assert.strictEqual(thrown.ok, false);
  assert.strictEqual(thrown.error, '调度炸了');

  // 未注入的能力被调用时回错误而非崩溃
  const missing = await controller.handle({ id: 3, op: 'list-windows' });
  assert.strictEqual(missing.ok, false);
  assert.match(missing.error, /未注入能力/);
});

//// 行协议逐行解析命令交处理器,把结果写回输出 [@busybee 2026-06-14] ////
test('行协议解析命令、回结果、解析失败回错误行', async () => {
  const input = new EventEmitter();
  input.resume = () => {};
  input.setEncoding = () => {};
  const output = memoryOutput();
  const channel = new LineChannel({
    input,
    output,
    handle: async (command) => ({ id: command.id, ok: true, result: { echo: command.op } })
  });
  channel.start();

  // 一次到达两条命令,且第二条跨两段到达
  input.emit('data', '{"id":1,"op":"a"}\n{"id":2,');
  input.emit('data', '"op":"b"}\n');
  // 非法 JSON 行回错误行
  input.emit('data', '不是 json\n');
  await new Promise((resolve) => setImmediate(resolve));

  const lines = output.lines().map((l) => JSON.parse(l));
  assert.deepStrictEqual(lines[0], { id: 1, ok: true, result: { echo: 'a' } });
  assert.deepStrictEqual(lines[1], { id: 2, ok: true, result: { echo: 'b' } });
  assert.strictEqual(lines[2].ok, false);
  assert.match(lines[2].error, /合法 JSON/);

  // 停后不再处理输入
  channel.stop();
  input.emit('data', '{"id":3,"op":"c"}\n');
  await new Promise((resolve) => setImmediate(resolve));
  assert.strictEqual(output.lines().length, 3);
});

//// 窗口快照折成纯数据,死窗标记不存活 [@busybee 2026-06-14] ////
test('窗口快照取名称、存活、可见与边界', () => {
  const live = { isVisible: () => true, getBounds: () => ({ x: 1, y: 2, width: 300, height: 300 }), isDestroyed: () => false };
  const dead = { isDestroyed: () => true };
  const snap = snapshotWindows({ pet: live, bubble: dead, settings: null }, (win) => Boolean(win) && !win.isDestroyed());

  assert.deepStrictEqual(snap[0], { name: 'pet', alive: true, visible: true, bounds: { x: 1, y: 2, width: 300, height: 300 } });
  assert.deepStrictEqual(snap[1], { name: 'bubble', alive: false, visible: false, bounds: null });
  assert.deepStrictEqual(snap[2], { name: 'settings', alive: false, visible: false, bounds: null });
});

//// 摘要剥掉大字段只留纯数据,发言取 utterance.text [@busybee 2026-06-14] ////
test('事件摘要只留可安全行化的纯数据', () => {
  const summary = summarize({ type: 'UtteranceProduced', utterance: { text: '你好', audioAlignment: { audio: Buffer.alloc(1000) } }, bubbleDurationMs: 8000 });
  assert.deepStrictEqual(summary, { type: 'UtteranceProduced', text: '你好', bubbleDurationMs: 8000 });
});

//// 装配在回环套接字上接受连接、回命令结果并转发领域事件 [@busybee 2026-06-14] ////
test('装配在回环套接字上回结果并转发领域事件', async () => {
  const bus = new EventBus();
  const ticks = [];
  let port = null;
  const mounted = mountAutomation({
    eventBus: bus,
    caps: { runTick: async () => ticks.push(1) },
    announce: ({ port: p }) => { port = p; }
  });

  await waitUntil(() => port !== null, 2000, '套接字监听');

  const socket = net.connect(port, '127.0.0.1');
  const lines = [];
  let buffer = '';
  socket.setEncoding('utf8');
  socket.on('data', (chunk) => {
    buffer += chunk;
    let nl;
    while ((nl = buffer.indexOf('\n')) >= 0) {
      const line = buffer.slice(0, nl).trim();
      buffer = buffer.slice(nl + 1);
      if (line) lines.push(JSON.parse(line));
    }
  });
  await waitUntil(() => lines.some((l) => l.event === 'automation-ready'), 2000, '就绪事件');

  // 命令经套接字回结果
  socket.write(JSON.stringify({ id: 7, op: 'schedule-tick' }) + '\n');
  await waitUntil(() => lines.some((l) => l.id === 7), 2000, '命令回应');
  const tickResp = lines.find((l) => l.id === 7);
  assert.deepStrictEqual(tickResp, { id: 7, ok: true, result: { ticked: true } });
  assert.strictEqual(ticks.length, 1);

  // 领域事件转发到连接
  bus.publish({ type: 'UtteranceProduced', text: '在写代码呀', intentId: 'observe-response' });
  await waitUntil(() => lines.some((l) => l.event === 'UtteranceProduced'), 2000, '产物事件');
  const produced = lines.find((l) => l.event === 'UtteranceProduced');
  assert.strictEqual(produced.payload.text, '在写代码呀');

  socket.destroy();
  mounted.stop();
});

//// 轮询等一个条件成立或超时 [@busybee 2026-06-14] ////
function waitUntil(predicate, timeoutMs, label) {
  return new Promise((resolve, reject) => {
    const start = Date.now();
    const timer = setInterval(() => {
      if (predicate()) { clearInterval(timer); resolve(); }
      else if (Date.now() - start > timeoutMs) { clearInterval(timer); reject(new Error(`等待超时:${label}`)); }
    }, 20);
  });
}
