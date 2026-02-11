/**
 * Audio State Machine
 * Three modes with graceful degradation: tts → default-audio → silent
 */
class AudioStateMachine {
    constructor() {
        this.preferredMode = 'tts';   // user preference: 'tts' | 'default-audio' | 'silent'
        this.effectiveMode = 'silent'; // actual mode after degradation
        this.ttsAvailable = false;
        this.defaultAudioAvailable = false;
        this.defaultAudioClips = [];   // preloaded Audio objects
        this.onModeChange = null;      // callback(effectiveMode)
    }

    /**
     * Set user's preferred mode and recompute effective mode
     */
    setPreferredMode(mode) {
        const valid = ['tts', 'default-audio', 'silent'];
        if (!valid.includes(mode)) mode = 'tts';
        this.preferredMode = mode;
        this._recompute();
    }

    /**
     * Update TTS availability (called when TTS status changes)
     */
    setTTSAvailable(available) {
        this.ttsAvailable = !!available;
        this._recompute();
    }

    /**
     * Update default audio availability
     */
    setDefaultAudioAvailable(available, clips) {
        this.defaultAudioAvailable = !!available;
        this.defaultAudioClips = clips || [];
        this._recompute();
    }

    /**
     * Get a random default audio clip (returns Audio object or null)
     */
    getRandomClip() {
        if (this.defaultAudioClips.length === 0) return null;
        const idx = Math.floor(Math.random() * this.defaultAudioClips.length);
        return this.defaultAudioClips[idx];
    }

    /**
     * Recompute effective mode based on preference + availability
     */
    _recompute() {
        const prev = this.effectiveMode;

        if (this.preferredMode === 'silent') {
            this.effectiveMode = 'silent';
        } else if (this.preferredMode === 'tts') {
            if (this.ttsAvailable) {
                this.effectiveMode = 'tts';
            } else if (this.defaultAudioAvailable) {
                this.effectiveMode = 'default-audio';
            } else {
                this.effectiveMode = 'silent';
            }
        } else if (this.preferredMode === 'default-audio') {
            if (this.defaultAudioAvailable) {
                this.effectiveMode = 'default-audio';
            } else {
                this.effectiveMode = 'silent';
            }
        }

        if (prev !== this.effectiveMode && this.onModeChange) {
            this.onModeChange(this.effectiveMode);
        }
    }

    getStatus() {
        return {
            preferredMode: this.preferredMode,
            effectiveMode: this.effectiveMode,
            ttsAvailable: this.ttsAvailable,
            defaultAudioAvailable: this.defaultAudioAvailable,
            clipCount: this.defaultAudioClips.length
        };
    }
}

window.AudioStateMachine = AudioStateMachine;
