/**
 * TTS Service — VOICEVOX Core FFI wrapper using koffi
 *
 * Runs in Electron main process. Loads voicevox_core.dll via koffi,
 * initializes synthesizer with Open JTalk + ONNX Runtime, and provides
 * text-to-speech synthesis returning WAV buffers.
 *
 * Circuit breaker: 3 consecutive failures → degrade to silent, retry after 60s.
 */

const path = require('path');
const fs = require('fs');
const koffi = require('koffi');

const VOICEVOX_RESULT_OK = 0;

class TTSService {
    constructor() {
        this.lib = null;
        this.onnxruntime = null;
        this.openJtalk = null;
        this.synthesizer = null;
        this.modelLoaded = false;
        this.initialized = false;
        this._fn = null;

        // Circuit breaker
        this.failCount = 0;
        this.maxFails = 3;
        this.degraded = false;
        this.degradedAt = 0;
        this.retryInterval = 60000;

        // Config
        this.styleId = 0;
        this.speedScale = 1.0;
        this.pitchScale = 0.0;
        this.volumeScale = 1.0;
    }

    /**
     * Initialize the VOICEVOX Core synthesizer.
     * @param {string} voicevoxDir - Path to voicevox_core/ directory
     * @param {string[]} [vvmFiles] - VVM files to load (default: ['0.vvm', '8.vvm'])
     * @returns {boolean}
     */
    init(voicevoxDir, vvmFiles) {
        if (this.initialized) return true;
        try {
            const coreDll = path.join(
                voicevoxDir, 'c_api',
                'voicevox_core-windows-x64-0.16.3', 'lib',
                'voicevox_core.dll'
            );
            const onnxDll = path.join(
                voicevoxDir, 'voicevox_onnxruntime-win-x64-1.17.3',
                'lib', 'voicevox_onnxruntime.dll'
            );
            const dictDir = path.join(voicevoxDir, 'open_jtalk_dic_utf_8-1.11');
            const modelsDir = path.join(voicevoxDir, 'models');

            this._defineTypes();
            this.lib = koffi.load(coreDll);
            this._bindFunctions();

            // 1. Load ONNX Runtime
            const onnxOut = [null];
            let rc = this._fn.loadOnnxruntime({ filename: onnxDll }, onnxOut);
            if (rc !== VOICEVOX_RESULT_OK) throw new Error(`loadOnnxruntime: ${this._getError(rc)}`);
            this.onnxruntime = onnxOut[0];

            // 2. Open JTalk
            const jtalkOut = [null];
            rc = this._fn.newOpenJtalk(dictDir, jtalkOut);
            if (rc !== VOICEVOX_RESULT_OK) throw new Error(`newOpenJtalk: ${this._getError(rc)}`);
            this.openJtalk = jtalkOut[0];

            // 3. Synthesizer
            const initOpts = this._fn.makeDefaultInitOptions();
            const synthOut = [null];
            rc = this._fn.newSynthesizer(this.onnxruntime, this.openJtalk, initOpts, synthOut);
            if (rc !== VOICEVOX_RESULT_OK) throw new Error(`newSynthesizer: ${this._getError(rc)}`);
            this.synthesizer = synthOut[0];

            // 4. Load configured VVM files
            const defaultVvms = ['0.vvm', '8.vvm'];
            const toLoad = vvmFiles && vvmFiles.length > 0 ? vvmFiles : defaultVvms;
            let loadedCount = 0;
            console.log(`[TTS] Loading ${toLoad.length} VVM files: ${toLoad.join(', ')}`);
            for (const vvmFile of toLoad) {
                const vvmPath = path.join(modelsDir, vvmFile);
                if (!fs.existsSync(vvmPath)) {
                    console.warn(`[TTS] Skip ${vvmFile}: file not found`);
                    continue;
                }
                const modelOut = [null];
                rc = this._fn.openVoiceModel(vvmPath, modelOut);
                if (rc !== VOICEVOX_RESULT_OK) {
                    console.warn(`[TTS] Skip ${vvmFile}: openVoiceModel failed`);
                    continue;
                }
                rc = this._fn.loadVoiceModel(this.synthesizer, modelOut[0]);
                this._fn.deleteVoiceModel(modelOut[0]);
                if (rc !== VOICEVOX_RESULT_OK) {
                    console.warn(`[TTS] Skip ${vvmFile}: loadVoiceModel failed`);
                    continue;
                }
                loadedCount++;
                console.log(`[TTS] Loaded ${vvmFile} (${loadedCount}/${toLoad.length})`);
            }
            this.modelLoaded = loadedCount > 0;
            this.initialized = true;

            const ver = this._fn.getVersion();
            console.log(`[TTS] VOICEVOX Core v${ver} initialized, ${loadedCount}/${toLoad.length} models loaded`);
            return true;
        } catch (err) {
            console.error('[TTS] Init failed:', err.message);
            this.initialized = false;
            return false;
        }
    }

    _defineTypes() {
        koffi.opaque('VoicevoxOnnxruntime');
        koffi.opaque('OpenJtalkRc');
        koffi.opaque('VoicevoxSynthesizer');
        koffi.opaque('VoicevoxVoiceModelFile');
        koffi.struct('VoicevoxLoadOnnxruntimeOptions', { filename: 'const char *' });
        koffi.struct('VoicevoxInitializeOptions', {
            acceleration_mode: 'int32', cpu_num_threads: 'uint16'
        });
        koffi.struct('VoicevoxSynthesisOptions', { enable_interrogative_upspeak: 'bool' });
        koffi.struct('VoicevoxTtsOptions', { enable_interrogative_upspeak: 'bool' });
    }

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
            // Use void** to preserve raw pointers for proper freeing
            createAudioQuery: l.func('int32 voicevox_synthesizer_create_audio_query(VoicevoxSynthesizer *, const char *, uint32, _Out_ void **)'),
            synthesis: l.func('int32 voicevox_synthesizer_synthesis(VoicevoxSynthesizer *, const char *, uint32, VoicevoxSynthesisOptions, _Out_ uintptr_t *, _Out_ void **)'),
            tts: l.func('int32 voicevox_synthesizer_tts(VoicevoxSynthesizer *, const char *, uint32, VoicevoxTtsOptions, _Out_ uintptr_t *, _Out_ void **)'),
            jsonFree: l.func('void voicevox_json_free(void *)'),
            wavFree: l.func('void voicevox_wav_free(void *)'),
            createMetasJson: l.func('void * voicevox_synthesizer_create_metas_json(VoicevoxSynthesizer *)'),
            errorMessage: l.func('const char * voicevox_error_result_to_message(int32)'),
            getVersion: l.func('const char * voicevox_get_version()'),
            makeDefaultSynthesisOptions: l.func('VoicevoxSynthesisOptions voicevox_make_default_synthesis_options()'),
            makeDefaultTtsOptions: l.func('VoicevoxTtsOptions voicevox_make_default_tts_options()'),
        };
    }

    _getError(code) {
        if (!this._fn) return `code ${code}`;
        return this._fn.errorMessage(code) || `code ${code}`;
    }

    /**
     * Synthesize Japanese text to WAV buffer.
     * Uses audio_query for parameter control (speed, pitch, volume).
     * @param {string} text - Japanese text
     * @param {number} [styleId] - Override style ID
     * @returns {Buffer|null} WAV data or null on failure
     */
    synthesize(text, styleId) {
        if (!this.initialized) return null;
        if (this._checkDegraded()) return null;

        const sid = styleId ?? this.styleId;
        try {
            // Create audio query — get raw pointer via void**
            const queryOut = [null];
            let rc = this._fn.createAudioQuery(this.synthesizer, text, sid, queryOut);
            if (rc !== VOICEVOX_RESULT_OK) throw new Error(`createAudioQuery: ${this._getError(rc)}`);

            const queryPtr = queryOut[0];
            let query;
            try {
                const queryStr = koffi.decode(queryPtr, 'char', -1);
                query = JSON.parse(queryStr);
            } finally {
                this._fn.jsonFree(queryPtr);
            }
            query.speedScale = this.speedScale;
            query.pitchScale = this.pitchScale;
            query.volumeScale = this.volumeScale;
            const queryJson = JSON.stringify(query);

            // Synthesize — get raw pointer via void**
            const wavLenOut = [0];
            const wavOut = [null];
            const synthOpts = this._fn.makeDefaultSynthesisOptions();
            rc = this._fn.synthesis(this.synthesizer, queryJson, sid, synthOpts, wavLenOut, wavOut);
            if (rc !== VOICEVOX_RESULT_OK) throw new Error(`synthesis: ${this._getError(rc)}`);

            const wavPtr = wavOut[0];
            const wavLen = wavLenOut[0];
            const wavBuf = Buffer.from(koffi.decode(wavPtr, 'uint8', wavLen));
            this._fn.wavFree(wavPtr);

            this._onSuccess();
            return wavBuf;
        } catch (err) {
            console.error('[TTS] Synthesis failed:', err.message);
            this._onFailure();
            return null;
        }
    }

    /**
     * Simple TTS shorthand (no parameter control).
     * @param {string} text - Japanese text
     * @param {number} [styleId]
     * @returns {Buffer|null}
     */
    tts(text, styleId) {
        if (!this.initialized) return null;
        if (this._checkDegraded()) return null;

        const sid = styleId ?? this.styleId;
        try {
            const wavLenOut = [0];
            const wavOut = [null];
            const opts = this._fn.makeDefaultTtsOptions();
            const rc = this._fn.tts(this.synthesizer, text, sid, opts, wavLenOut, wavOut);
            if (rc !== VOICEVOX_RESULT_OK) throw new Error(`tts: ${this._getError(rc)}`);

            const wavPtr = wavOut[0];
            const wavBuf = Buffer.from(koffi.decode(wavPtr, 'uint8', wavLenOut[0]));
            this._fn.wavFree(wavPtr);

            this._onSuccess();
            return wavBuf;
        } catch (err) {
            console.error('[TTS] TTS failed:', err.message);
            this._onFailure();
            return null;
        }
    }

    // Circuit breaker
    _checkDegraded() {
        if (!this.degraded) return false;
        if (Date.now() - this.degradedAt >= this.retryInterval) {
            console.log('[TTS] Circuit breaker: attempting recovery');
            this.degraded = false;
            this.failCount = 0;
            return false;
        }
        return true;
    }

    _onSuccess() { this.failCount = 0; }

    _onFailure() {
        this.failCount++;
        if (this.failCount >= this.maxFails) {
            console.warn(`[TTS] Circuit breaker: degraded after ${this.failCount} failures`);
            this.degraded = true;
            this.degradedAt = Date.now();
        }
    }

    setConfig({ styleId, speedScale, pitchScale, volumeScale } = {}) {
        if (styleId !== undefined) this.styleId = styleId;
        if (speedScale !== undefined) this.speedScale = speedScale;
        if (pitchScale !== undefined) this.pitchScale = pitchScale;
        if (volumeScale !== undefined) this.volumeScale = volumeScale;
    }

    isAvailable() { return this.initialized && !this._checkDegraded(); }

    getAvailableVvms(voicevoxDir) {
        try {
            const modelsDir = path.join(voicevoxDir, 'models');
            return fs.readdirSync(modelsDir).filter(f => f.endsWith('.vvm')).sort();
        } catch { return []; }
    }

    getMetas() {
        if (!this.initialized || !this.synthesizer) return [];
        try {
            const ptr = this._fn.createMetasJson(this.synthesizer);
            const json = koffi.decode(ptr, 'char', -1);
            const metas = JSON.parse(json);
            this._fn.jsonFree(ptr);
            return metas;
        } catch (err) {
            console.error('[TTS] getMetas failed:', err.message);
            return [];
        }
    }

    destroy() {
        if (this.synthesizer && this._fn) {
            this._fn.deleteSynthesizer(this.synthesizer);
            this.synthesizer = null;
        }
        if (this.openJtalk && this._fn) {
            this._fn.deleteOpenJtalk(this.openJtalk);
            this.openJtalk = null;
        }
        this.initialized = false;
        this.modelLoaded = false;
        console.log('[TTS] Destroyed');
    }
}

module.exports = { TTSService };