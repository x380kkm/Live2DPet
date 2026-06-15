// audience: internal
// # event-forwarding.integration.test
// 行为仿真:领域事件经渲染转发器变成 IPC 推送。装配真实 EventBus、EmotionReaction、EmotionSelector,
// 转发器复刻 main.js 的 subscribeRenderForwarders(该函数在 main.js 内私有未导出,此处按其逻辑接线)。
// 只把 LLM 客户端与宠物窗口句柄换成 mock。喂一条 UtteranceProduced,断言它经情绪链产出 EmotionSelected
// 并被转成 play-expression,且发言文本被转成气泡推送;另用真实 ipc-router 的 show-pet-chat 断言 chat-bubble-message。

const { test } = require('node:test');
const assert = require('node:assert');

const router = require('../../src/platform/ipc/ipc-router');
const { EventBus } = require('../../src/platform/bus/event-bus');
const { EmotionSelector } = require('../../src/domain/emotion/emotion-selector');
const { EmotionReaction } = require('../../src/domain/pet/emotion-reaction');
const { registerUiHandlers } = require('../../src/platform/ipc/handlers/ui-handlers');

//// 记录每次 send 的假窗口句柄 [@x380kkm 2026-06-13] ////
function fakeWindow() {
  const sent = [];
  const record = (channel, args) => sent.push({ channel, args });
  return {
    sent,
    destroyed: false,
    isDestroyed() {
      return this.destroyed;
    },
    webContents: { send: (channel, ...args) => record(channel, args) },
    send: (channel, ...args) => record(channel, args)
  };
}

//// 排空已挂起的微任务,等情绪选取这类未 await 的异步链落地 [@x380kkm 2026-06-13] ////
function flush() {
  return new Promise((resolve) => setImmediate(resolve));
}

//// 复刻 main.js 的 subscribeRenderForwarders:发言交气泡控制器、说话态进宠物窗口、选定情绪进表情 [@x380kkm 2026-06-14] ////
// main.js 里该函数私有未导出;此处按其当前逻辑接线,以行为仿真验证它产出的 IPC 推送与气泡调用。
// 发言产物经气泡控制器显示到独立气泡窗口(不再向宠物窗口推送气泡通道);说话态与表情仍推宠物窗口。
function subscribeRenderForwarders(eventBus, getPetWindow, bubble = { show() {} }) {
  const spokenTextOf = (event) => {
    if (!event) return '';
    if (event.utterance && event.utterance.text) return event.utterance.text;
    return event.text || '';
  };
  eventBus.subscribe('UtteranceProduced', (event) => {
    const text = spokenTextOf(event);
    if (!text) return;
    bubble.show(text, event.bubbleDurationMs || 8000);
    const win = getPetWindow();
    if (win) win.webContents.send('talking-state-changed', true);
  }, () => router.isAlive(getPetWindow()));
  eventBus.subscribe('EmotionSelected', (event) => {
    const win = getPetWindow();
    if (!win || !event.name) return;
    win.webContents.send('play-expression', event.name);
  }, () => router.isAlive(getPetWindow()));
}

//// 选定情绪事件转成宠物窗口的 play-expression 推送 [@x380kkm 2026-06-13] ////
test('EmotionSelected 经渲染转发器转成 play-expression 推送', () => {
  const bus = new EventBus();
  const petWindow = fakeWindow();
  subscribeRenderForwarders(bus, () => petWindow);

  bus.publish({ type: 'EmotionSelected', name: 'surprised' });

  assert.deepStrictEqual(petWindow.sent, [{ channel: 'play-expression', args: ['surprised'] }]);
});

//// 空情绪名不推送,留给渲染层自行回退 [@x380kkm 2026-06-13] ////
test('EmotionSelected 名为空时不推送', () => {
  const bus = new EventBus();
  const petWindow = fakeWindow();
  subscribeRenderForwarders(bus, () => petWindow);

  bus.publish({ type: 'EmotionSelected', name: '' });

  assert.strictEqual(petWindow.sent.length, 0);
});

//// 发言产物经真实情绪链触发情绪选取,再转成 play-expression 与气泡推送 [@x380kkm 2026-06-13] ////
test('UtteranceProduced 经真实情绪链产出 EmotionSelected 并转成 play-expression', async () => {
  const bus = new EventBus();
  const petWindow = fakeWindow();

  // 真实情绪选择器:有界 LLM 从可选名里挑 happy;EmotionReaction 订阅发言产物喂它。
  const emotionLlm = { async complete() { return { text: 'happy', toolCalls: [], raw: {} }; } };
  const selector = new EmotionSelector(bus, emotionLlm, { enabledNames: ['happy', 'sad'], promptTemplate: '{0}' });
  new EmotionReaction({ eventBus: bus, emotionSelector: selector }).start();
  const bubble = { calls: [], show(m, t) { this.calls.push([m, t]); } };
  subscribeRenderForwarders(bus, () => petWindow, bubble);

  // pet 编排器载荷形态:{ text }。
  bus.publish({ type: 'UtteranceProduced', text: '你好呀', bubbleDurationMs: 5000 });
  await flush();

  // 转发器立即把发言交气泡控制器并切说话态;情绪链经一次异步 LLM 调用后转成 play-expression。
  assert.deepStrictEqual(bubble.calls, [['你好呀', 5000]]);
  assert.deepStrictEqual(petWindow.sent, [
    { channel: 'talking-state-changed', args: [true] },
    { channel: 'play-expression', args: ['happy'] }
  ]);
});

//// 死窗口被总线统一过滤,转发不向已毁窗口推送 [@x380kkm 2026-06-13] ////
test('宠物窗口已毁时渲染转发器不再推送', () => {
  const bus = new EventBus();
  const petWindow = fakeWindow();
  petWindow.destroyed = true;
  subscribeRenderForwarders(bus, () => petWindow);

  bus.publish({ type: 'EmotionSelected', name: 'happy' });

  assert.strictEqual(petWindow.sent.length, 0);
});

//// show-pet-chat 命令侧经气泡控制器显示发言,不再向宠物窗口推送 [@x380kkm 2026-06-14] ////
test('show-pet-chat 命令经气泡控制器显示发言', async () => {
  router.reset();
  const petWindow = fakeWindow();
  const bubble = { calls: [], show(m, t) { this.calls.push([m, t]); }, resize() {}, hide() {} };
  registerUiHandlers({
    router,
    getPetWindow: () => petWindow,
    getSettingsWindow: () => null,
    isAlive: (w) => router.isAlive(w),
    bubble
  });

  await router.dispatch('show-pet-chat', ['你好呀', 5000]);

  assert.deepStrictEqual(bubble.calls, [['你好呀', 5000]]);
  assert.strictEqual(petWindow.sent.length, 0);
});
