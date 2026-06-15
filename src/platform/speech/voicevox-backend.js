// audience: internal
// # voicevox-backend
// SpeechBackend 的 VOICEVOX 实现:FFI 内存、目录结构、版本号、WAV 头全收在此。
// 不变量:VOICEVOX 的 FFI 句柄与原生内存生命周期只在本文件管理,不外泄。
// 构造注入:koffi、path、fs 三个第三方依赖与一个 CircuitBreaker 实例从外部传入,本文件不直接抓全局,第三方类型只在此适配层出现。

const { SpeechBackend } = require('./speech-backend');

// VOICEVOX FFI 调用成功的返回码
const VOICEVOX_RESULT_OK = 0;
// 默认加载的语音模型文件
const DEFAULT_VVM_FILES = ['0.vvm', '8.vvm'];
// 启用 GPU 时传给初始化选项的加速模式枚举值
const ACCELERATION_MODE_GPU = 2;

//// VOICEVOX 后端,经 FFI 把日语文本合成为 WAV 缓冲 [@busybee 2026-06-13] ////
class VoicevoxBackend extends SpeechBackend {
  constructor({ koffi, path, fs, circuitBreaker, prosodyShaper } = {}) {
    super();
    this.koffi = koffi;
    this.path = path;
    this.fs = fs;
    this.circuitBreaker = circuitBreaker;
    // 韵律塑形函数 (query, tone) => 逐句音量增益段,经注入;它原地改 query 做逐句塑形并返回增益段,缺省不注入即不塑形。
    this.prosodyShaper = prosodyShaper || null;

    this.lib = null;
    this.onnxruntime = null;
    this.openJtalk = null;
    this.synthesizer = null;
    this.modelLoaded = false;
    this.initialized = false;
    this._fn = null;

    this.styleId = 0;
    this.speedScale = 1.0;
    this.pitchScale = 0.0;
    this.volumeScale = 1.0;
    this.isGpu = false;
    // 语气控制开关:开启时合成按情绪叠加 audio_query 语气字段,默认关。
    this.toneControl = false;

    // 合成结果缓存:键为文本与影响输出的参数,只存成功的 WAV,按最近使用上限淘汰。
    this._cache = new Map();
    this._cacheLimit = 128;
  }

  //// 加载 DLL、起 ONNX 运行时与合成器、加载语音模型,准备好后端 [@busybee 2026-06-13] ////
  init(voicevoxDir, vvmFiles, options) {
    if (this.initialized) return true;
    const { path, fs } = this;
    try {
      const coreDll = path.join(
        voicevoxDir, 'c_api',
        'voicevox_core-windows-x64-0.16.3', 'lib',
        'voicevox_core.dll'
      );
      // 按是否要 GPU 在 DirectML 与 CPU 两个 onnxruntime 目录间选一个
      const dmlDir = path.join(voicevoxDir, 'voicevox_onnxruntime-win-x64-dml-1.17.3');
      const cpuDir = path.join(voicevoxDir, 'voicevox_onnxruntime-win-x64-1.17.3');
      const wantGpu = !!(options && options.gpuMode) && fs.existsSync(path.join(dmlDir, 'lib', 'voicevox_onnxruntime.dll'));
      const onnxDll = path.join(wantGpu ? dmlDir : cpuDir, 'lib', 'voicevox_onnxruntime.dll');
      const dictDir = path.join(voicevoxDir, 'open_jtalk_dic_utf_8-1.11');
      const modelsDir = path.join(voicevoxDir, 'models');

      // koffi 不允许重复注册类型,故 DLL 与类型只在首次加载
      if (!this.lib) {
        this._defineTypes();
        this.lib = this.koffi.load(coreDll);
        this._bindFunctions();
      }

      const onnxOut = [null];
      let rc = this._fn.loadOnnxruntime({ filename: onnxDll }, onnxOut);
      if (rc !== VOICEVOX_RESULT_OK) throw new Error(`loadOnnxruntime: ${this._getError(rc)}`);
      this.onnxruntime = onnxOut[0];

      const jtalkOut = [null];
      rc = this._fn.newOpenJtalk(dictDir, jtalkOut);
      if (rc !== VOICEVOX_RESULT_OK) throw new Error(`newOpenJtalk: ${this._getError(rc)}`);
      this.openJtalk = jtalkOut[0];

      const initOpts = this._fn.makeDefaultInitOptions();
      if (wantGpu) initOpts.acceleration_mode = ACCELERATION_MODE_GPU;
      const synthOut = [null];
      rc = this._fn.newSynthesizer(this.onnxruntime, this.openJtalk, initOpts, synthOut);
      if (rc !== VOICEVOX_RESULT_OK) throw new Error(`newSynthesizer: ${this._getError(rc)}`);
      this.synthesizer = synthOut[0];
      this.isGpu = wantGpu;

      this.modelLoaded = this._loadVoiceModels(modelsDir, vvmFiles);
      this.initialized = true;
      return true;
    } catch (err) {
      console.error('[VoicevoxBackend] 初始化失败:', err.message);
      this.initialized = false;
      return false;
    }
  }
  //// /加载 DLL、起 ONNX 运行时与合成器、加载语音模型 ////

  //// 逐个打开并加载语音模型文件,返回是否至少加载了一个 [@busybee 2026-06-13] ////
  _loadVoiceModels(modelsDir, vvmFiles) {
    const { path, fs } = this;
    const toLoad = vvmFiles && vvmFiles.length > 0 ? vvmFiles : DEFAULT_VVM_FILES;
    let loadedCount = 0;
    for (const vvmFile of toLoad) {
      const vvmPath = path.join(modelsDir, vvmFile);
      if (!fs.existsSync(vvmPath)) continue;
      const modelOut = [null];
      let rc = this._fn.openVoiceModel(vvmPath, modelOut);
      if (rc !== VOICEVOX_RESULT_OK) continue;
      rc = this._fn.loadVoiceModel(this.synthesizer, modelOut[0]);
      this._fn.deleteVoiceModel(modelOut[0]);
      if (rc !== VOICEVOX_RESULT_OK) continue;
      loadedCount++;
    }
    return loadedCount > 0;
  }
  //// /逐个打开并加载语音模型文件 ////

  //// 声明 VOICEVOX FFI 用到的不透明指针与结构体类型 [@busybee 2026-06-13] ////
  _defineTypes() {
    const koffi = this.koffi;
    koffi.opaque('VoicevoxOnnxruntime');
    koffi.opaque('OpenJtalkRc');
    koffi.opaque('VoicevoxSynthesizer');
    koffi.opaque('VoicevoxVoiceModelFile');
    koffi.struct('VoicevoxLoadOnnxruntimeOptions', { filename: 'const char *' });
    koffi.struct('VoicevoxInitializeOptions', {
      acceleration_mode: 'int32', cpu_num_threads: 'uint16'
    });
    koffi.struct('VoicevoxSynthesisOptions', { enable_interrogative_upspeak: 'bool' });
  }
  //// /声明 VOICEVOX FFI 用到的不透明指针与结构体类型 ////

  //// 把 DLL 导出函数绑定成可调用句柄表 [@busybee 2026-06-13] ////
  _bindFunctions() {
    const l = this.lib;
    this._fn = {
      loadOnnxruntime: l.func('int32 voicevox_onnxruntime_load_once(VoicevoxLoadOnnxruntimeOptions, _Out_ VoicevoxOnnxruntime **)'),
      newOpenJtalk: l.func('int32 voicevox_open_jtalk_rc_new(const char *, _Out_ OpenJtalkRc **)'),
      deleteOpenJtalk: l.func('void voicevox_open_jtalk_rc_delete(OpenJtalkRc *)'),
      makeDefaultInitOptions: l.func('VoicevoxInitializeOptions voicevox_make_default_initialize_options()'),
      newSynthesizer: l.func('int32 voicevox_synthesizer_new(VoicevoxOnnxruntime *, OpenJtalkRc *, VoicevoxInitializeOptions, _Out_ VoicevoxSynthesizer **)'),
      deleteSynthesizer: l.func('void voicevox_synthesizer_delete(VoicevoxSynthesizer *)'),
      openVoiceModel: l.func('int32 voicevox_voice_model_file_open(const char *, _Out_ VoicevoxVoiceModelFile **)'),
      deleteVoiceModel: l.func('void voicevox_voice_model_file_delete(VoicevoxVoiceModelFile *)'),
      loadVoiceModel: l.func('int32 voicevox_synthesizer_load_voice_model(VoicevoxSynthesizer *, VoicevoxVoiceModelFile *)'),
      // 用 void** 接住原始指针以便正确释放
      createAudioQuery: l.func('int32 voicevox_synthesizer_create_audio_query(VoicevoxSynthesizer *, const char *, uint32, _Out_ void **)'),
      // 从 AquesTalk 风格片假名(带 ' 重音核、/ 句界、ー 长音)生成 audio_query,供中文凑音素按声调置重音
      createAudioQueryFromKana: l.func('int32 voicevox_synthesizer_create_audio_query_from_kana(VoicevoxSynthesizer *, const char *, uint32, _Out_ void **)'),
      synthesis: l.func('int32 voicevox_synthesizer_synthesis(VoicevoxSynthesizer *, const char *, uint32, VoicevoxSynthesisOptions, _Out_ uintptr_t *, _Out_ void **)'),
      jsonFree: l.func('void voicevox_json_free(void *)'),
      wavFree: l.func('void voicevox_wav_free(void *)'),
      createMetasJson: l.func('void * voicevox_synthesizer_create_metas_json(VoicevoxSynthesizer *)'),
      errorMessage: l.func('const char * voicevox_error_result_to_message(int32)'),
      getVersion: l.func('const char * voicevox_get_version()'),
      makeDefaultSynthesisOptions: l.func('VoicevoxSynthesisOptions voicevox_make_default_synthesis_options()'),
    };
  }
  //// /把 DLL 导出函数绑定成可调用句柄表 ////

  //// 把 FFI 返回码翻成可读错误文本 [@busybee 2026-06-13] ////
  _getError(code) {
    if (!this._fn) return `code ${code}`;
    return this._fn.errorMessage(code) || `code ${code}`;
  }

  //// 把日语文本合成为 WAV 缓冲,经熔断器执行,失败或断开态返回 null [@busybee 2026-06-13] ////
  synthesize(text, options) {
    if (!this.initialized) return null;
    const opts = options || {};
    const sid = opts.styleId != null ? opts.styleId : this.styleId;
    const speedScale = opts.speedScale != null ? opts.speedScale : this.speedScale;
    const pitchScale = opts.pitchScale != null ? opts.pitchScale : this.pitchScale;
    const volumeScale = opts.volumeScale != null ? opts.volumeScale : this.volumeScale;
    const tone = opts.tone || null;

    const cacheKey = `${text}|${sid}|${speedScale}|${pitchScale}|${volumeScale}|${tone ? JSON.stringify(tone) : ''}`;
    const hit = this._cacheGet(cacheKey);
    if (hit) return hit;

    const run = () => this._synthesizeOnce(text, sid, speedScale, pitchScale, volumeScale, tone);
    let wav;
    if (this.circuitBreaker) {
      wav = this.circuitBreaker.execute(run);
    } else {
      try {
        wav = run();
      } catch (err) {
        console.error('[VoicevoxBackend] 合成失败:', err.message);
        return null;
      }
    }
    if (wav) this._cachePut(cacheKey, wav);
    return wav;
  }

  //// 为文本创建并解析 audio_query,释放原生 JSON 内存后返回纯数据对象 [@busybee 2026-06-14] ////
  // 产物含 accent_phrases(每句逐个 mora 的 pitch 与 length)与句间 pause_mora,供句内与句间微调读改。
  audioQuery(text, sid) {
    const queryOut = [null];
    const rc = this._fn.createAudioQuery(this.synthesizer, text, sid, queryOut);
    if (rc !== VOICEVOX_RESULT_OK) throw new Error(`createAudioQuery: ${this._getError(rc)}`);
    const queryPtr = queryOut[0];
    try {
      return JSON.parse(this.koffi.decode(queryPtr, 'char', -1));
    } finally {
      this._fn.jsonFree(queryPtr);
    }
  }
  //// /为文本创建并解析 audio_query ////

  //// 从 AquesTalk 风格片假名创建并解析 audio_query,重音核由 ' 指定,供中文按声调置重音 [@busybee 2026-06-15] ////
  // kana 为带重音记号的全角片假名(' 重音核、/ 无停顿句界、、停顿句界、ー 长音、_ 无声化);释放原生内存后返回纯数据。
  audioQueryFromKana(kana, sid) {
    const queryOut = [null];
    const rc = this._fn.createAudioQueryFromKana(this.synthesizer, kana, sid, queryOut);
    if (rc !== VOICEVOX_RESULT_OK) throw new Error(`createAudioQueryFromKana: ${this._getError(rc)}`);
    const queryPtr = queryOut[0];
    try {
      return JSON.parse(this.koffi.decode(queryPtr, 'char', -1));
    } finally {
      this._fn.jsonFree(queryPtr);
    }
  }
  //// /从 AquesTalk 风格片假名创建并解析 audio_query ////

  //// 从一份(可能已被改过的)audio_query 直接合成 WAV,供参数探索与查表渲染用 [@busybee 2026-06-14] ////
  // 不走缓存与增益,失败返回 null;调用方自负 query 的合法性。
  synthesizeQuery(query, sid) {
    if (!this.initialized) return null;
    const wavLenOut = [0];
    const wavOut = [null];
    const synthOpts = this._fn.makeDefaultSynthesisOptions();
    const rc = this._fn.synthesis(this.synthesizer, JSON.stringify(query), sid, synthOpts, wavLenOut, wavOut);
    if (rc !== VOICEVOX_RESULT_OK) {
      return null;
    }
    const wavBuf = Buffer.from(this.koffi.decode(wavOut[0], 'uint8', wavLenOut[0]));
    this._fn.wavFree(wavOut[0]);
    return wavBuf;
  }
  //// /从一份 audio_query 直接合成 WAV ////

  //// 走 audio_query 路径合成一次,带速度音高音量控制,释放原生内存 [@busybee 2026-06-13] ////
  _synthesizeOnce(text, sid, speedScale, pitchScale, volumeScale, tone) {
    const koffi = this.koffi;
    const query = this.audioQuery(text, sid);
    query.speedScale = speedScale;
    query.pitchScale = pitchScale;
    query.volumeScale = volumeScale;
    if (tone) this._applyTone(query, tone);
    let gainSpans = null;
    if (tone && this.prosodyShaper) gainSpans = this.prosodyShaper(query, tone);
    const queryJson = JSON.stringify(query);

    const wavLenOut = [0];
    const wavOut = [null];
    const synthOpts = this._fn.makeDefaultSynthesisOptions();
    const rc = this._fn.synthesis(this.synthesizer, queryJson, sid, synthOpts, wavLenOut, wavOut);
    if (rc !== VOICEVOX_RESULT_OK) throw new Error(`synthesis: ${this._getError(rc)}`);

    const wavPtr = wavOut[0];
    const wavBuf = Buffer.from(koffi.decode(wavPtr, 'uint8', wavLenOut[0]));
    this._fn.wavFree(wavPtr);
    if (gainSpans) this._applyGain(wavBuf, gainSpans);
    return wavBuf;
  }
  //// /走 audio_query 路径合成一次 ////

  //// 把 tone 的全局量叠加到 audio_query:只设整段首尾停顿 [@busybee 2026-06-14] ////
  // audio_query 只有全局量的项在此;音量包络在波形层、其余逐句量由 prosody-shaper 按包络处理。
  _applyTone(query, tone) {
    if (tone.prePhonemeLength != null) query.prePhonemeLength = tone.prePhonemeLength;
    if (tone.postPhonemeLength != null) query.postPhonemeLength = tone.postPhonemeLength;
  }

  //// 按逐句增益段对 16 位 PCM 加增益,段界用一阶平滑避免爆音 [@busybee 2026-06-14] ////
  _applyGain(wav, spans) {
    if (!wav || wav.length <= 44 || !spans || spans.length === 0) {
      return wav;
    }
    const sampleRate = wav.readUInt32LE(24);
    const numChannels = wav.readUInt16LE(22);
    const bitsPerSample = wav.readUInt16LE(34);
    if (bitsPerSample !== 16 || !sampleRate || !numChannels) {
      return wav;
    }
    const frameBytes = numChannels * 2;
    const totalFrames = Math.floor((wav.length - 44) / frameBytes);
    const bounds = [];
    let cum = 0;
    for (const span of spans) {
      cum += span.durationSec;
      bounds.push(Math.round(cum * sampleRate));
    }
    // 一阶平滑:每帧把当前增益向所在段的目标增益靠拢,约 20 毫秒过渡,避免段界爆音。
    const alpha = 1 / Math.max(1, Math.floor(sampleRate * 0.02));
    let s = 0;
    let g = spans[0].gain;
    for (let i = 0; i < totalFrames; i++) {
      while (s < spans.length - 1 && i >= bounds[s]) s += 1;
      g += (spans[s].gain - g) * alpha;
      for (let c = 0; c < numChannels; c++) {
        const off = 44 + i * frameBytes + c * 2;
        let v = Math.round(wav.readInt16LE(off) * g);
        if (v > 32767) v = 32767;
        else if (v < -32768) v = -32768;
        wav.writeInt16LE(v, off);
      }
    }
    return wav;
  }
  //// /把语气字段叠加到 audio_query ////

  //// 取缓存的合成结果,命中则移到最近使用端 [@busybee 2026-06-14] ////
  _cacheGet(key) {
    const hit = this._cache.get(key);
    if (!hit) return null;
    this._cache.delete(key);
    this._cache.set(key, hit);
    return hit;
  }

  //// 存一条合成结果,超过上限淘汰最久未用的 [@busybee 2026-06-14] ////
  _cachePut(key, wav) {
    this._cache.set(key, wav);
    if (this._cache.size > this._cacheLimit) {
      const oldest = this._cache.keys().next().value;
      this._cache.delete(oldest);
    }
  }

  //// 用一句极短文本合成一次预热模型,消除首句的冷启动延迟 [@busybee 2026-06-14] ////
  warmup() {
    if (!this.initialized) return false;
    return Boolean(this.synthesize('あ'));
  }

  //// 设置默认风格与速度音高音量参数 [@busybee 2026-06-13] ////
  setConfig({ styleId, speedScale, pitchScale, volumeScale, toneControl } = {}) {
    if (styleId !== undefined) this.styleId = styleId;
    if (speedScale !== undefined) this.speedScale = speedScale;
    if (pitchScale !== undefined) this.pitchScale = pitchScale;
    if (volumeScale !== undefined) this.volumeScale = volumeScale;
    if (toneControl !== undefined) this.toneControl = toneControl;
  }

  //// 报告后端是否可用,初始化且熔断器未断开时为真 [@busybee 2026-06-13] ////
  isAvailable() {
    if (!this.initialized) return false;
    return this.circuitBreaker ? !this.circuitBreaker.isOpen() : true;
  }

  //// 列出模型目录下的语音模型文件名 [@busybee 2026-06-13] ////
  getAvailableVvms(voicevoxDir) {
    const { path, fs } = this;
    try {
      const modelsDir = path.join(voicevoxDir, 'models');
      return fs.readdirSync(modelsDir).filter(f => f.endsWith('.vvm')).sort();
    } catch {
      return [];
    }
  }

  //// 取已加载语音的元数据列表 [@busybee 2026-06-13] ////
  getMetas() {
    if (!this.initialized || !this.synthesizer) return [];
    try {
      const ptr = this._fn.createMetasJson(this.synthesizer);
      const json = this.koffi.decode(ptr, 'char', -1);
      const metas = JSON.parse(json);
      this._fn.jsonFree(ptr);
      return metas;
    } catch (err) {
      console.error('[VoicevoxBackend] getMetas 失败:', err.message);
      return [];
    }
  }

  //// 取 VOICEVOX Core 版本号 [@busybee 2026-06-13] ////
  getVersion() {
    if (!this._fn) return null;
    return this._fn.getVersion();
  }

  //// 释放 FFI 句柄与原生内存,回到未初始化态 [@busybee 2026-06-13] ////
  dispose() {
    if (this.synthesizer && this._fn) {
      this._fn.deleteSynthesizer(this.synthesizer);
      this.synthesizer = null;
    }
    if (this.openJtalk && this._fn) {
      this._fn.deleteOpenJtalk(this.openJtalk);
      this.openJtalk = null;
    }
    this._cache.clear();
    this.initialized = false;
    this.modelLoaded = false;
  }
  //// /释放 FFI 句柄与原生内存 ////
}

module.exports = { VoicevoxBackend };
