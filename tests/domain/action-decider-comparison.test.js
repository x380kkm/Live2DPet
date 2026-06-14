// audience: internal
// # action-decider-comparison.test
// 仿真对比两种决策策略:用桩 LLM 喂同一批场景,断言拆分策略与合并策略都产出合法动作与非空台词;
// 量出各自的调用次数、提示词估算 token 与模拟时延,并验证情绪当前值抬升模组动作的占比。

const { test } = require('node:test');
const assert = require('node:assert');
const { SplitIntentDecider, MainLlmDecider } = require('../../src/domain/pet/action-decider');
const { WeightModel, isModAction } = require('../../src/domain/pet/weight-model');
const { LowDiscrepancySequence } = require('../../src/domain/pet/low-discrepancy');
const { StepId } = require('../../src/shared/step-catalog');

//// 估算一组 messages 的提示词 token:按四字符一 token 取上整 [@busybee 2026-06-14] ////
function estimateMessagesTokens(messages) {
  return messages.reduce((sum, m) => sum + Math.ceil(((m.content || '').length) / 4), 0);
}
//// /估算一组 messages 的提示词 token ////

//// 从 user 消息里取「建议动作」的 id,模拟模型顺着建议走 [@busybee 2026-06-14] ////
function suggestedFrom(messages) {
  const user = messages.find((m) => m.role === 'user');
  const content = user ? user.content : '';
  const match = content.match(/建议动作:([^\n]+)/);
  return match ? match[1].trim() : '';
}
//// /从 user 消息里取「建议动作」的 id ////

//// 桩 LLM:按步与系统提示返回脚本化回应,记录每次调用的 token 与模拟时延 [@busybee 2026-06-14] ////
// 时延模型:基线 250 毫秒加每输出 token 4 毫秒,让一次大调用与两次小调用可比。
function makeStubLlm() {
  const calls = [];
  const reply = '我看你在忙,先歇会儿吧~';
  return {
    calls,
    async complete(request) {
      const promptTokens = estimateMessagesTokens(request.messages);
      const system = (request.messages.find((m) => m.role === 'system') || {}).content || '';
      let text;
      if (request.step === StepId.IntentRoute) {
        text = suggestedFrom(request.messages);
      } else if (system.includes('ACTION')) {
        text = `ACTION: ${suggestedFrom(request.messages)}\n${reply}`;
      } else {
        text = reply;
      }
      const outTokens = Math.ceil(text.length / 4);
      const latencyMs = 250 + outTokens * 4;
      calls.push({ step: request.step, promptTokens, outTokens, latencyMs });
      return { text };
    }
  };
}
//// /桩 LLM ////

// 同一批候选:一条对话动作、两条模组动作;来源决定模组归属。
function makeCandidates() {
  return [
    { id: 'idle-chat', trigger: { when: 'idle' }, origin: 'builtin' },
    { id: 'body-click', trigger: { when: 'mod-event', event: 'click' }, origin: 'body-interaction' },
    { id: 'wave-hand', trigger: { when: 'mod-event', event: 'wave' }, origin: 'gesture-mod' }
  ];
}

function buildContext(intent, scope) {
  return `态势=${(scope && scope.situationDigest) || ''}`;
}

//// 两策略在同一场景下都产出合法动作与非空台词 [@busybee 2026-06-14] ////
test('两策略都从候选里产出合法动作与非空台词', async () => {
  const candidates = makeCandidates();
  const scope = { situationDigest: '用户在写代码', emotion: 0 };
  const weightModel = new WeightModel();

  const splitLlm = makeStubLlm();
  const split = new SplitIntentDecider({ llm: splitLlm, weightModel, sampler: new LowDiscrepancySequence(0), buildContext });
  const splitOut = await split.decide(candidates, scope);

  const mainLlm = makeStubLlm();
  const main = new MainLlmDecider({ llm: mainLlm, weightModel, sampler: new LowDiscrepancySequence(0), buildContext });
  const mainOut = await main.decide(candidates, scope);

  for (const out of [splitOut, mainOut]) {
    assert.ok(out.intent, '应选出一个意图');
    assert.ok(candidates.some((c) => c.id === out.intent.id), '选中的意图应在候选里');
    assert.ok(out.response && out.response.text && out.response.text.length > 0, '应产出非空台词');
  }
});
//// /两策略在同一场景下都产出合法动作与非空台词 ////

//// 拆分策略两次调用、合并策略一次调用 [@busybee 2026-06-14] ////
test('多候选时拆分策略两次调用、合并策略一次调用', async () => {
  const candidates = makeCandidates();
  const scope = { situationDigest: '用户在看视频', emotion: 0 };
  const weightModel = new WeightModel();

  const splitLlm = makeStubLlm();
  await new SplitIntentDecider({ llm: splitLlm, weightModel, sampler: new LowDiscrepancySequence(0), buildContext }).decide(candidates, scope);

  const mainLlm = makeStubLlm();
  await new MainLlmDecider({ llm: mainLlm, weightModel, sampler: new LowDiscrepancySequence(0), buildContext }).decide(candidates, scope);

  assert.strictEqual(splitLlm.calls.length, 2, '拆分策略应有选意图与产台词两次调用');
  assert.strictEqual(splitLlm.calls[0].step, StepId.IntentRoute);
  assert.strictEqual(splitLlm.calls[1].step, StepId.Dialogue);
  assert.strictEqual(mainLlm.calls.length, 1, '合并策略应只有一次调用');
  assert.strictEqual(mainLlm.calls[0].step, StepId.Dialogue);
});
//// /拆分策略两次调用、合并策略一次调用 ////

//// 情绪当前值抬升模组动作的占比 [@busybee 2026-06-14] ////
test('情绪越高,模组动作的占比越大', () => {
  const candidates = makeCandidates();
  const weightModel = new WeightModel();

  const modShare = (emotion) => {
    const eff = weightModel.effectiveWeights(candidates, emotion);
    const total = eff.reduce((s, x) => s + x.weight, 0);
    const mod = eff.filter((x) => x.isMod).reduce((s, x) => s + x.weight, 0);
    return mod / total;
  };

  const calm = modShare(0);
  const excited = modShare(0.9);
  assert.ok(excited > calm, `情绪高时模组占比应更大:${calm} 比 ${excited}`);
});
//// /情绪当前值抬升模组动作的占比 ////

//// 对比汇总:打印两策略的调用次数、提示词 token 与模拟时延 [@busybee 2026-06-14] ////
test('对比汇总两策略的调用结构与开销', async () => {
  const candidates = makeCandidates();
  const scope = { situationDigest: '用户在写代码', emotion: 0.3 };
  const weightModel = new WeightModel();

  const sum = (calls, key) => calls.reduce((s, c) => s + c[key], 0);

  const splitLlm = makeStubLlm();
  await new SplitIntentDecider({ llm: splitLlm, weightModel, sampler: new LowDiscrepancySequence(0), buildContext }).decide(candidates, scope);
  const mainLlm = makeStubLlm();
  await new MainLlmDecider({ llm: mainLlm, weightModel, sampler: new LowDiscrepancySequence(0), buildContext }).decide(candidates, scope);

  const report = (name, calls) => `${name}: 调用 ${calls.length} 次, 提示词 ${sum(calls, 'promptTokens')} token, 模拟时延 ${sum(calls, 'latencyMs')} 毫秒`;
  console.log('[决策策略对比]', report('拆分', splitLlm.calls));
  console.log('[决策策略对比]', report('合并', mainLlm.calls));

  // 合并策略调用更少,但单次提示词更大;两者都应产出。两条结构性断言守住对比口径。
  assert.ok(mainLlm.calls.length < splitLlm.calls.length, '合并策略调用次数应更少');
  assert.ok(sum(mainLlm.calls, 'promptTokens') > 0 && sum(splitLlm.calls, 'promptTokens') > 0);
});
//// /对比汇总 ////

//// 屏蔽钩子抑制模组动作后只剩对话候选,决策器据此只产不选 [@busybee 2026-06-14] ////
test('屏蔽钩子抑制模组动作后,拆分策略只产台词不再选意图', async () => {
  const candidates = makeCandidates();
  const scope = { situationDigest: '用户在专注写文档', emotion: 0.5 };
  const weightModel = new WeightModel();
  const dropMods = (list) => list.filter((intent) => !isModAction(intent));

  const llm = makeStubLlm();
  const out = await new SplitIntentDecider({ llm, weightModel, sampler: new LowDiscrepancySequence(0), buildContext, mask: dropMods }).decide(candidates, scope);

  assert.strictEqual(out.intent.id, 'idle-chat', '屏蔽模组后应只剩对话候选');
  assert.strictEqual(llm.calls.length, 1, '只剩一个候选时省去选择调用,只产台词');
  assert.strictEqual(llm.calls[0].step, StepId.Dialogue);
  assert.ok(out.response.text.length > 0);
});
//// /屏蔽钩子抑制模组动作后只剩对话候选 ////
