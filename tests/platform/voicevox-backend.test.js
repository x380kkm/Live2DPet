// 运行方式:node --test tests/platform/voicevox-backend.test.js
const { test } = require('node:test');
const assert = require('node:assert');
const { VoicevoxBackend } = require('../../src/platform/speech/voicevox-backend');
const { SpeechBackend } = require('../../src/platform/speech/speech-backend');
const { CircuitBreaker } = require('../../src/platform/speech/circuit-breaker');

//// 构造一组记录调用的 koffi、path、fs 模拟,FFI 全部返回成功 [@busybee 2026-06-13] ////
function makeMocks(overrides = {}) {
  const calls = { freed: [], funcs: [] };
  // audio_query 返回的 JSON,合成器会读出后覆盖速度音高音量再回填
  const queryJson = JSON.stringify({ speedScale: 1, pitchScale: 0, volumeScale: 1 });

  const fn = {
    loadOnnxruntime: (opts, out) => { out[0] = 'onnx'; return 0; },
    newOpenJtalk: (dir, out) => { out[0] = 'jtalk'; return 0; },
    deleteOpenJtalk: () => { calls.freed.push('jtalk'); },
    makeDefaultInitOptions: () => ({ acceleration_mode: 0, cpu_num_threads: 0 }),
    newSynthesizer: (onnx, jtalk, opts, out) => { out[0] = 'synth'; return 0; },
    deleteSynthesizer: () => { calls.freed.push('synth'); },
    openVoiceModel: (p, out) => { out[0] = 'model'; return 0; },
    deleteVoiceModel: () => { calls.freed.push('model'); },
    loadVoiceModel: () => 0,
    createAudioQuery: (synth, text, sid, out) => { out[0] = 'queryPtr'; calls.lastQueryText = text; calls.lastQuerySid = sid; return 0; },
    synthesis: (synth, json, sid, opts, lenOut, wavOut) => { calls.lastSynthJson = json; lenOut[0] = 4; wavOut[0] = 'wavPtr'; return 0; },
    jsonFree: (ptr) => { calls.freed.push('json'); },
    wavFree: (ptr) => { calls.freed.push('wav'); },
    createMetasJson: () => 'metasPtr',
    errorMessage: (code) => `error ${code}`,
    getVersion: () => '0.16.3',
    makeDefaultSynthesisOptions: () => ({ enable_interrogative_upspeak: false }),
  };
  Object.assign(fn, overrides.fn || {});

  const koffi = {
    opaque: () => {},
    struct: () => {},
    load: () => ({ func: (sig) => { calls.funcs.push(sig); return makeBoundFn(sig, fn); } }),
    decode: (ptr, type, len) => {
      if (ptr === 'queryPtr') return queryJson;
      if (ptr === 'metasPtr') return JSON.stringify([{ name: 'meta' }]);
      if (ptr === 'wavPtr') return [1, 2, 3, 4];
      return '';
    },
  };

  const path = { join: (...parts) => parts.join('/') };
  const fs = {
    existsSync: overrides.existsSync || (() => true),
    readdirSync: overrides.readdirSync || (() => ['0.vvm', '8.vvm', 'notes.txt']),
  };
  return { koffi, path, fs, calls, fn };
}

//// 把 DLL 函数签名映射回对应的模拟实现,绑定名按签名里的函数名匹配 [@busybee 2026-06-13] ////
function makeBoundFn(sig, fn) {
  const map = {
    voicevox_onnxruntime_load_once: fn.loadOnnxruntime,
    voicevox_open_jtalk_rc_new: fn.newOpenJtalk,
    voicevox_open_jtalk_rc_delete: fn.deleteOpenJtalk,
    voicevox_make_default_initialize_options: fn.makeDefaultInitOptions,
    voicevox_synthesizer_new: fn.newSynthesizer,
    voicevox_synthesizer_delete: fn.deleteSynthesizer,
    voicevox_voice_model_file_open: fn.openVoiceModel,
    voicevox_voice_model_file_delete: fn.deleteVoiceModel,
    voicevox_synthesizer_load_voice_model: fn.loadVoiceModel,
    voicevox_synthesizer_create_audio_query: fn.createAudioQuery,
    voicevox_synthesizer_synthesis: fn.synthesis,
    voicevox_json_free: fn.jsonFree,
    voicevox_wav_free: fn.wavFree,
    voicevox_synthesizer_create_metas_json: fn.createMetasJson,
    voicevox_error_result_to_message: fn.errorMessage,
    voicevox_get_version: fn.getVersion,
    voicevox_make_default_synthesis_options: fn.makeDefaultSynthesisOptions,
  };
  const name = Object.keys(map).find(n => sig.includes(n));
  return map[name];
}

//// VoicevoxBackend 是 SpeechBackend 的具体实现 [@busybee 2026-06-13] ////
test('是 SpeechBackend 的子类', () => {
  const backend = new VoicevoxBackend(makeMocks());
  assert.ok(backend instanceof SpeechBackend);
});

//// 全部 FFI 返回成功时初始化置位且报告可用 [@busybee 2026-06-13] ////
test('init 成功后可用', () => {
  const mocks = makeMocks();
  const backend = new VoicevoxBackend(mocks);
  const ok = backend.init('/voicevox', null, {});
  assert.strictEqual(ok, true);
  assert.strictEqual(backend.initialized, true);
  assert.strictEqual(backend.isAvailable(), true);
});

//// FFI 返回非零错误码时初始化失败且报告不可用 [@busybee 2026-06-13] ////
test('init 在 FFI 报错时失败', () => {
  const mocks = makeMocks({ fn: { newSynthesizer: () => 7 } });
  const backend = new VoicevoxBackend(mocks);
  const ok = backend.init('/voicevox', null, {});
  assert.strictEqual(ok, false);
  assert.strictEqual(backend.initialized, false);
  assert.strictEqual(backend.isAvailable(), false);
});

//// 未初始化时合成直接返回 null,不触碰 FFI [@busybee 2026-06-13] ////
test('未初始化时 synthesize 返回 null', () => {
  const backend = new VoicevoxBackend(makeMocks());
  assert.strictEqual(backend.synthesize('text', {}), null);
});

//// 合成把 options 的参数写进 audio_query 后回填,产出 WAV 缓冲 [@busybee 2026-06-13] ////
test('synthesize 用 options 覆盖参数并产出缓冲', () => {
  const mocks = makeMocks();
  const backend = new VoicevoxBackend(mocks);
  backend.init('/voicevox', null, {});
  const buf = backend.synthesize('こんにちは', { styleId: 5, speedScale: 1.5, pitchScale: 0.2, volumeScale: 0.8 });

  assert.ok(Buffer.isBuffer(buf));
  assert.deepStrictEqual(buf, Buffer.from([1, 2, 3, 4]));
  assert.strictEqual(mocks.calls.lastQuerySid, 5);
  const sentQuery = JSON.parse(mocks.calls.lastSynthJson);
  assert.strictEqual(sentQuery.speedScale, 1.5);
  assert.strictEqual(sentQuery.pitchScale, 0.2);
  assert.strictEqual(sentQuery.volumeScale, 0.8);
});

//// 合成成功时释放掉 query 的 JSON 内存与 WAV 原生内存 [@busybee 2026-06-13] ////
test('synthesize 释放原生内存', () => {
  const mocks = makeMocks();
  const backend = new VoicevoxBackend(mocks);
  backend.init('/voicevox', null, {});
  backend.synthesize('text', {});
  assert.ok(mocks.calls.freed.includes('json'));
  assert.ok(mocks.calls.freed.includes('wav'));
});

//// 合成时缺省用 setConfig 设的默认风格 [@busybee 2026-06-13] ////
test('synthesize 在缺省时用默认 styleId', () => {
  const mocks = makeMocks();
  const backend = new VoicevoxBackend(mocks);
  backend.init('/voicevox', null, {});
  backend.setConfig({ styleId: 9 });
  backend.synthesize('text');
  assert.strictEqual(mocks.calls.lastQuerySid, 9);
});

//// 合成的 FFI 失败被注入的熔断器吞掉,连续失败到上限后断开并报告不可用 [@busybee 2026-06-13] ////
test('synthesize 失败经熔断器降级', () => {
  const mocks = makeMocks({ fn: { synthesis: () => 9 } });
  const breaker = new CircuitBreaker({ maxFailures: 2, fallback: null });
  const backend = new VoicevoxBackend({ ...mocks, circuitBreaker: breaker });
  backend.init('/voicevox', null, {});

  assert.strictEqual(backend.synthesize('text'), null);
  assert.strictEqual(backend.isAvailable(), true);
  assert.strictEqual(backend.synthesize('text'), null);
  assert.strictEqual(breaker.isOpen(), true);
  assert.strictEqual(backend.isAvailable(), false);
});

//// 没注入熔断器时合成失败也能安全返回 null [@busybee 2026-06-13] ////
test('无熔断器时失败返回 null', () => {
  const mocks = makeMocks({ fn: { createAudioQuery: () => 3 } });
  const backend = new VoicevoxBackend(mocks);
  backend.init('/voicevox', null, {});
  assert.strictEqual(backend.synthesize('text'), null);
});

//// 缺失的模型文件被跳过,全部缺失则标记未加载模型 [@busybee 2026-06-13] ////
test('全部模型缺失时 modelLoaded 为假', () => {
  const mocks = makeMocks({ existsSync: (p) => !String(p).endsWith('.vvm') });
  const backend = new VoicevoxBackend(mocks);
  backend.init('/voicevox', ['0.vvm'], {});
  assert.strictEqual(backend.modelLoaded, false);
});

//// 只列出 .vvm 后缀的模型文件并排序 [@busybee 2026-06-13] ////
test('getAvailableVvms 只列 vvm 文件', () => {
  const backend = new VoicevoxBackend(makeMocks());
  const vvms = backend.getAvailableVvms('/voicevox');
  assert.deepStrictEqual(vvms, ['0.vvm', '8.vvm']);
});

//// dispose 释放合成器与 Open JTalk 句柄并回到未初始化态 [@busybee 2026-06-13] ////
test('dispose 释放句柄', () => {
  const mocks = makeMocks();
  const backend = new VoicevoxBackend(mocks);
  backend.init('/voicevox', null, {});
  backend.dispose();
  assert.ok(mocks.calls.freed.includes('synth'));
  assert.ok(mocks.calls.freed.includes('jtalk'));
  assert.strictEqual(backend.initialized, false);
  assert.strictEqual(backend.synthesizer, null);
});

//// 报告 VOICEVOX Core 版本号 [@busybee 2026-06-13] ////
test('getVersion 返回版本号', () => {
  const backend = new VoicevoxBackend(makeMocks());
  backend.init('/voicevox', null, {});
  assert.strictEqual(backend.getVersion(), '0.16.3');
});

//// 同文本同参数第二次合成命中缓存,不再调 FFI [@busybee 2026-06-14] ////
test('synthesize 命中缓存时不重复调 FFI', () => {
  let queryCalls = 0;
  const mocks = makeMocks({ fn: { createAudioQuery: (s, t, sid, out) => { queryCalls++; out[0] = 'queryPtr'; return 0; } } });
  const backend = new VoicevoxBackend(mocks);
  backend.init('/voicevox', null, {});
  const first = backend.synthesize('こんにちは', { styleId: 3 });
  const second = backend.synthesize('こんにちは', { styleId: 3 });
  assert.deepStrictEqual(first, second);
  assert.strictEqual(queryCalls, 1, '第二次同文本同参数应命中缓存');
  backend.synthesize('こんにちは', { styleId: 9 });
  assert.strictEqual(queryCalls, 2, '参数不同不命中缓存,重新合成');
});

//// dispose 清空合成缓存,避免换模型后取到旧音色 [@busybee 2026-06-14] ////
test('dispose 后缓存清空', () => {
  let queryCalls = 0;
  const mocks = makeMocks({ fn: { createAudioQuery: (s, t, sid, out) => { queryCalls++; out[0] = 'queryPtr'; return 0; } } });
  const backend = new VoicevoxBackend(mocks);
  backend.init('/voicevox', null, {});
  backend.synthesize('text', {});
  backend.dispose();
  backend.init('/voicevox', null, {});
  backend.synthesize('text', {});
  assert.strictEqual(queryCalls, 2, 'dispose 清空缓存,重建后重新合成');
});

//// warmup 据初始化状态返回真假 [@busybee 2026-06-14] ////
test('warmup 已初始化合成预热返回真,未初始化返回假', () => {
  const cold = new VoicevoxBackend(makeMocks());
  assert.strictEqual(cold.warmup(), false);
  const hot = new VoicevoxBackend(makeMocks());
  hot.init('/voicevox', null, {});
  assert.strictEqual(hot.warmup(), true);
});

//// 传 tone 时把语调与停顿字段写进 audio_query [@busybee 2026-06-14] ////
test('synthesize 传 tone 时写入语调与停顿字段', () => {
  const mocks = makeMocks();
  const backend = new VoicevoxBackend(mocks);
  backend.init('/voicevox', null, {});
  backend.synthesize('text', { tone: { intonationScale: 1.4, prePhonemeLength: 0.05, postPhonemeLength: 0.1 } });
  const sent = JSON.parse(mocks.calls.lastSynthJson);
  assert.strictEqual(sent.intonationScale, 1.4);
  assert.strictEqual(sent.prePhonemeLength, 0.05);
  assert.strictEqual(sent.postPhonemeLength, 0.1);
});

//// 不传 tone 时不加语气字段 [@busybee 2026-06-14] ////
test('synthesize 不传 tone 时不加语气字段', () => {
  const mocks = makeMocks();
  const backend = new VoicevoxBackend(mocks);
  backend.init('/voicevox', null, {});
  backend.synthesize('text', {});
  const sent = JSON.parse(mocks.calls.lastSynthJson);
  assert.strictEqual(sent.intonationScale, undefined);
});

//// setConfig 设置语气控制开关 [@busybee 2026-06-14] ////
test('setConfig 设置 toneControl 开关', () => {
  const backend = new VoicevoxBackend(makeMocks());
  assert.strictEqual(backend.toneControl, false);
  backend.setConfig({ toneControl: true });
  assert.strictEqual(backend.toneControl, true);
});
