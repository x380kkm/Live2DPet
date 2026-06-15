// audience: internal
// # core-loop.integration.test
// 行为仿真:装配真实的核心循环领域流水线(编排器、请求管线、提示词组装、意图注册表含出厂意图、
// 上下文源、情绪状态与选择器、发言会话、事件总线、感知采集与态势抽取),只把 LLM 客户端、感知帧、
// 存储仓储换成可注入的 mock。喂模拟输入,经事件总线断言输出。
// 覆盖:有视觉输入选「观察回应」并产出经清洗的发言、喂情绪、收集上下文;无视觉输入选「空闲闲聊」。

const { test } = require('node:test');
const assert = require('node:assert');

const { EventBus } = require('../../src/platform/bus/event-bus');
const { IntentRegistry } = require('../../src/domain/intent/intent-registry');
const { builtinIntents } = require('../../src/domain/intent/builtin-intents');
const { PetOrchestrator } = require('../../src/domain/pet/pet');
const { SplitIntentDecider } = require('../../src/domain/pet/action-decider');
const { WeightModel } = require('../../src/domain/pet/weight-model');
const { LowDiscrepancySequence } = require('../../src/domain/pet/low-discrepancy');
const { makeContextBuilder } = require('../../src/domain/pet/action-context-builder');
const { RequestPipeline } = require('../../src/domain/pet/request-pipeline');
const { PromptComposer } = require('../../src/domain/pet/prompt-composer');
const { PetScheduler } = require('../../src/domain/pet/scheduler');
const { PerceptionCollector } = require('../../src/domain/pet/perception-collector');
const { VlmExtractor } = require('../../src/domain/perception/vlm-extractor');
const { KeyframeBuffer } = require('../../src/domain/perception/keyframe-buffer');
const { MemoryStore } = require('../../src/domain/perception/memory-store');
const { EmotionState } = require('../../src/domain/emotion/emotion-state');
const { EmotionSelector, EMOTION_SELECTED } = require('../../src/domain/emotion/emotion-selector');
const { EmotionReaction } = require('../../src/domain/pet/emotion-reaction');
const { FewShotBank } = require('../../src/domain/fewshot/fewshot-bank');
const { FewShotResolver } = require('../../src/domain/fewshot/fewshot-resolver');
const { cleanResponse } = require('../../src/platform/llm/response-cleaner');

const { SituationDigestSource } = require('../../src/domain/pet/sources/situation-digest-source');
const { VisualMemorySource } = require('../../src/domain/pet/sources/visual-memory-source');
const { FocusInfoSource } = require('../../src/domain/pet/sources/focus-info-source');
const { LayoutInfoSource } = require('../../src/domain/pet/sources/layout-info-source');
const { PetPositionSource } = require('../../src/domain/pet/sources/pet-position-source');
const { ToneHintSource } = require('../../src/domain/pet/sources/tone-hint-source');
const { RecentRepliesSource } = require('../../src/domain/pet/sources/recent-replies-source');
const { IdleInfoSource } = require('../../src/domain/pet/sources/idle-info-source');

//// 内存仓储:实现 MemoryStore 期待的 get/put 键值接口 [@x380kkm 2026-06-13] ////
function memoryRepository() {
  const store = new Map();
  return {
    async get(key) {
      return store.has(key) ? store.get(key) : null;
    },
    async put(key, value) {
      store.set(key, value);
    }
  };
}

//// 脚本化 LLM 客户端:按调用顺序回放给定回复,记录每次请求 [@x380kkm 2026-06-13] ////
// 每条脚本项形如 { match?, text }:match 命中请求里的系统提示时回该项,否则按队列顺序取。
function scriptedLlm(defaultText) {
  const calls = [];
  const queue = [];
  return {
    calls,
    enqueue(text) {
      queue.push(text);
      return this;
    },
    async complete(request) {
      calls.push(request);
      const text = queue.length > 0 ? queue.shift() : defaultText;
      return { text, toolCalls: [], raw: {} };
    }
  };
}

//// 按 id 索引上下文源的内存注册表,RequestPipeline 经 get(id) 取源 [@x380kkm 2026-06-13] ////
function sourceRegistry(sources) {
  const byId = new Map(sources.map((s) => [s.id, s]));
  return { get: (id) => byId.get(id) || null };
}

//// 假感知源:每次 capture 回放一帧,队列空后回 null,记录调用次数 [@x380kkm 2026-06-13] ////
function scriptedPerception(frames) {
  const queue = frames.slice();
  let captureCount = 0;
  return {
    get captureCount() {
      return captureCount;
    },
    async capture() {
      captureCount++;
      return queue.length > 0 ? queue.shift() : null;
    }
  };
}

//// 把循环各模块装配成一套真实流水线,LLM 与感知与仓储经参数注入 [@x380kkm 2026-06-13] ////
// 返回各协作者引用,供用例直接驱动 scheduler 或 pet 并断言总线产物。
function assembleLoop(opts) {
  const bus = new EventBus();
  const clock = { value: 1000000, now() { return this.value; } };

  // 意图注册表装入两条出厂意图:观察回应(有视觉输入)、空闲闲聊(空闲)。
  const registry = new IntentRegistry();
  registry.discoverBuiltins(builtinIntents());

  // 感知侧真实模块:关键帧缓冲、态势抽取器、记忆库,经内存仓储落记忆。
  const buffer = new KeyframeBuffer({ now: () => clock.now() });
  const repository = memoryRepository();
  const memoryStore = new MemoryStore({ repository, now: () => clock.now() });
  const perceptionLlm = opts.perceptionLlm;
  const extractor = new VlmExtractor(
    { llmClient: perceptionLlm, buffer, now: () => clock.now(), prompts: { select: 'sel', situation: 'sit' } },
    { selectIntervalMs: 0, situationBaseIntervalMs: 0, situationMaxIntervalMs: 0, minCandidates: 0 }
  );
  const collector = new PerceptionCollector({ buffer, extractor, memoryStore });

  // 上下文源:态势、视觉记忆、焦点、布局、宠物位置、语气提示、反重复,各以引用名为 id。
  const recentReplies = [];
  const sourceList = [
    new SituationDigestSource({ extractor }),
    new VisualMemorySource({ memoryStore, now: () => clock.now() }),
    new FocusInfoSource({ focusProvider: () => opts.focus || {} }),
    new LayoutInfoSource({ windowsProvider: () => opts.windows || [] }),
    new PetPositionSource({ boundsProvider: () => opts.petBounds || null }),
    new ToneHintSource({ toneProvider: () => opts.nextEmotion || null }),
    new RecentRepliesSource({ recentRepliesProvider: () => recentReplies }),
    new IdleInfoSource({ idleProvider: () => opts.idleSeconds != null ? opts.idleSeconds : 0 })
  ];
  const sources = sourceRegistry(sourceList);

  // few-shot 银行装入结构样例(只引结构,语气样例此处不注入即留空骨架)。
  const bank = new FewShotBank();
  bank.registerStructure({
    name: 'structure/observe-response',
    slots: ['opener'],
    turns: [{ role: 'user', template: '{{opener}}' }]
  });
  bank.registerStructure({
    name: 'structure/idle-chat',
    slots: ['opener'],
    turns: [{ role: 'user', template: '{{opener}}' }]
  });
  const fewShotResolver = new FewShotResolver(bank);

  const persona = { description: '一只好奇的桌面宠物', rules: '只说一句话' };
  const promptComposer = new PromptComposer({ fewShotResolver, persona });

  const mainLlm = opts.mainLlm;
  const pipeline = new RequestPipeline({
    sources,
    llmClient: mainLlm,
    promptComposer,
    // 把响应清洗器接成后处理过滤器,验证发言文本经清洗。
    filters: [(text) => cleanResponse(text)]
  });

  const pet = new PetOrchestrator({ pipeline, llmClient: mainLlm, eventBus: bus });

  // 决策器:与主进程同构装配,选意图走轻量路由步、台词委托富管线 pet.run(含发布)。
  const decider = new SplitIntentDecider({
    llm: mainLlm,
    weightModel: new WeightModel(),
    sampler: new LowDiscrepancySequence(0),
    buildContext: makeContextBuilder({ sources: sourceList }),
    produce: (intent, scope) => pet.run(intent, scope)
  });

  // 情绪:状态积累器每拍喂入,选择器订阅发言产物后经有界 LLM 选名。
  const emotionState = new EmotionState(bus, { threshold: 1, baseRatePerTick: 1 }, { random: () => 0 });
  const emotionSelector = new EmotionSelector(bus, opts.emotionLlm, {
    enabledNames: ['happy', 'sad', 'surprised'],
    promptTemplate: 'pick one of {0}'
  });
  const emotionReaction = new EmotionReaction({ eventBus: bus, emotionSelector });
  emotionReaction.start();

  // 发言产物喂反重复源:每条刚说出的话记入近期回复。
  bus.subscribe('UtteranceProduced', (event) => {
    const text = event.text || (event.utterance && event.utterance.text);
    if (text) recentReplies.push(text);
  });

  const scheduler = new PetScheduler(
    { perception: opts.perception, collector, registry, decider, emotionState, clock, timer: { setInterval() {}, clearInterval() {} } },
    { intervalMs: 0, chatGapMs: 0 }
  );

  return { bus, registry, pipeline, pet, decider, scheduler, emotionState, emotionSelector, mainLlm, recentReplies, collector };
}

//// 排空已挂起的微任务,等情绪选取这类未 await 的异步链落地 [@x380kkm 2026-06-13] ////
function flush() {
  return new Promise((resolve) => setImmediate(resolve));
}

//// 订阅一类事件,把收到的事件依序收集 [@x380kkm 2026-06-13] ////
function collect(bus, type) {
  const events = [];
  bus.subscribe(type, (e) => events.push(e));
  return events;
}

//// 核心循环:有视觉输入时选「观察回应」,产出经清洗的发言,喂情绪,上下文进提示词 [@x380kkm 2026-06-13] ////
test('有视觉输入时核心循环选观察回应并产出经清洗的发言', async () => {
  // 主 LLM 先答选意图(单候选时不会被调到),再答发言文本带 think 标签待清洗。
  const mainLlm = scriptedLlm('').enqueue('<think>盘算一下</think>你好');
  // 感知 LLM:选帧返回索引、抽态势返回桌面态势文本。
  const perceptionLlm = scriptedLlm('').enqueue('[0]').enqueue('用户在看代码编辑器');
  const emotionLlm = scriptedLlm('happy');
  const frame = { image: 'ZmFrZQ==', title: 'editor.js - Code', timestamp: 1000000 };
  const perception = scriptedPerception([frame]);

  const loop = assembleLoop({
    mainLlm, perceptionLlm, emotionLlm, perception,
    focus: { 'Code': 120 },
    petBounds: { x: 10, y: 20, width: 300, height: 300 },
    nextEmotion: '好奇'
  });

  const utterances = collect(loop.bus, 'UtteranceProduced');
  const emotionsSelected = collect(loop.bus, EMOTION_SELECTED);
  // EmotionState 每拍被喂 tick,阈值设为 1,一拍即到阈值发此事件。
  const thresholdReached = collect(loop.bus, 'EmotionThresholdReached');

  await loop.scheduler._driveOnce();
  await flush();

  // 选中了「观察回应」并产出发言。
  assert.strictEqual(utterances.length, 1, '应发布一条 UtteranceProduced');
  assert.strictEqual(utterances[0].intentId, 'observe-response');
  // 发言文本经 response-cleaner 剥掉 think 标签。
  assert.strictEqual(utterances[0].text, '你好');

  // 情绪被喂入:调度器每拍喂 EmotionState 一拍,到阈值发布 EmotionThresholdReached。
  assert.ok(thresholdReached.length >= 1, 'EmotionState 被喂入并到阈值');
  // 情绪被选取:EmotionReaction 订阅发言产物喂选择器,经有界 LLM 选出 happy。
  assert.strictEqual(emotionsSelected.length, 1, '应发布一次 EmotionSelected');
  assert.strictEqual(emotionsSelected[0].name, 'happy');

  // 上下文源被收集进提示词:发言请求的系统提示含态势、焦点、宠物位置、语气提示。
  const composeRequest = mainLlm.calls[mainLlm.calls.length - 1];
  const systemContent = composeRequest.messages[0].content;
  // 本拍抽出的态势经采集器写入记忆,再经视觉记忆源进入系统提示;
  // 真实缺陷:situationDigest 源读 extractor.keyframes()[0].situation,而抽取器从不回写该字段,故态势靠视觉记忆这条间接路径进提示。
  assert.match(systemContent, /用户在看代码编辑器/, '态势经视觉记忆进了系统提示');
  assert.match(systemContent, /好奇/, '语气提示进了系统提示');
  assert.match(systemContent, /300x300|\(10,20\)/, '宠物位置进了系统提示');
  assert.match(systemContent, /一只好奇的桌面宠物/, '人格进了系统提示');

  // 编码上述缺陷:抽取器选出的关键帧没有 situation 字段,态势摘要源渲染为空。
  const keyframe = loop.collector.extractor.keyframes()[0];
  assert.ok(keyframe, '抽取器选出了关键帧');
  assert.strictEqual(keyframe.situation, undefined, 'situationDigest 源依赖的 situation 字段从未被抽取器回写');
});

//// 空闲分支:无视觉输入时选「空闲闲聊」并产出发言 [@x380kkm 2026-06-13] ////
test('无视觉输入时核心循环选空闲闲聊', async () => {
  const mainLlm = scriptedLlm('').enqueue('一个人待着也不错');
  const perceptionLlm = scriptedLlm('');
  const emotionLlm = scriptedLlm('happy');
  // 感知源直接回 null:没有帧,态势为空,作用域落为空闲。
  const perception = scriptedPerception([]);

  const loop = assembleLoop({
    mainLlm, perceptionLlm, emotionLlm, perception,
    focus: { 'Code': 200 },
    nextEmotion: '惬意'
  });

  const utterances = collect(loop.bus, 'UtteranceProduced');

  await loop.scheduler._driveOnce();
  await flush();

  assert.strictEqual(utterances.length, 1);
  // 无视觉输入,候选只剩空闲闲聊,单候选直接选它、不耗选意图调用。
  assert.strictEqual(utterances[0].intentId, 'idle-chat');
  assert.strictEqual(utterances[0].text, '一个人待着也不错');

  // 空闲意图引的上下文源里语气提示有值,进了系统提示。
  const systemContent = loop.mainLlm.calls[loop.mainLlm.calls.length - 1].messages[0].content;
  assert.match(systemContent, /惬意/);
  // 感知源被调用过:确认走的是真实感知采集路径。
  assert.strictEqual(perception.captureCount, 1);
});

//// 单候选时不耗选意图调用,直接跑出该意图 [@x380kkm 2026-06-13] ////
test('两条出厂意图按视觉信号互斥触发,各自只剩单候选', async () => {
  const loop = assembleLoop({
    mainLlm: scriptedLlm('x'), perceptionLlm: scriptedLlm(''), emotionLlm: scriptedLlm('happy'),
    perception: scriptedPerception([])
  });

  const visualCandidates = loop.registry.candidates({ signals: { hasVisualInput: true } });
  const idleCandidates = loop.registry.candidates({ signals: { hasVisualInput: false } });

  assert.deepStrictEqual(visualCandidates.map((i) => i.id), ['observe-response']);
  assert.deepStrictEqual(idleCandidates.map((i) => i.id), ['idle-chat']);
});
