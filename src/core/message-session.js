/**
 * MessageSession - coordinates text, emotion, and audio for a single AI response.
 * New session cancels the previous one.
 *
 * Flow (TTS mode, high emotion):
 *   1. Parallel: TTS synthesis + AI emotion selection
 *   2. Synchronized: show bubble(duration=audio+buffer) + play audio + aligned emotion
 *
 * Flow (non-TTS or low emotion):
 *   1. Show bubble immediately (default 8s)
 *   2. Play default audio / silent
 *   3. Emotion independent (normal accumulation)
 */
class MessageSession {
    static _currentId = 0;

    /** Buffer added to audio duration for bubble display (ms) */
    static AUDIO_BUBBLE_BUFFER_MS = 800;
    /** Default bubble duration when no audio sync (ms) */
    static DEFAULT_BUBBLE_MS = 8000;
    /** Minimum bubble duration even with short audio (ms) */
    static MIN_BUBBLE_MS = 3000;
    /** Emotion value threshold for TTS-aligned emotion trigger */
    static EMOTION_ALIGN_THRESHOLD = 30;

    constructor() {
        this.id = ++MessageSession._currentId;
        this.cancelled = false;
        this.text = null;
        this._audioEndPromise = null;
    }

    isActive() {
        return !this.cancelled && this.id === MessageSession._currentId;
    }

    cancel() {
        this.cancelled = true;
        // Signal talking ended on cancel
        if (window.electronAPI && window.electronAPI.setTalkingState) {
            window.electronAPI.setTalkingState(false);
        }
    }

    async run(system) {
        if (!this.isActive()) return;

        // Phase 1: Prepare audio + select emotion in parallel
        const [prepared] = await Promise.all([
            system.prepareAudio(this.text),
            this._selectEmotion(system)
        ]);

        if (!this.isActive()) return;

        const hasTTSAudio = prepared && prepared.duration > 0;

        // Signal talking state START
        if (window.electronAPI && window.electronAPI.setTalkingState) {
            window.electronAPI.setTalkingState(true);
        }

        // Phase 2: Synchronized playback
        if (hasTTSAudio) {
            // TTS mode: sync bubble + audio + emotion
            const audioDur = prepared.duration;
            const bubbleDur = Math.max(
                audioDur + MessageSession.AUDIO_BUBBLE_BUFFER_MS,
                MessageSession.MIN_BUBBLE_MS
            );

            // Show bubble and play audio simultaneously
            window.electronAPI.showPetChat(this.text, bubbleDur);
            console.log(`[MessageSession] Sync: bubble=${Math.round(bubbleDur)}ms, audio=${Math.round(audioDur)}ms`);

            this._audioEndPromise = prepared.play();

            // Aligned emotion if value is high enough
            this._triggerEmotionAligned(system, bubbleDur);

            await this._audioEndPromise;
        } else {
            // Non-TTS: show bubble immediately, independent emotion
            window.electronAPI.showPetChat(this.text, MessageSession.DEFAULT_BUBBLE_MS);
            console.log('[MessageSession] Response (no TTS sync):', this.text);

            // Play default audio if available (fire-and-forget)
            if (prepared) {
                this._audioEndPromise = prepared.play();
            }

            // Independent emotion (normal accumulation path)
            this._triggerEmotionIndependent(system);

            if (this._audioEndPromise) await this._audioEndPromise;
        }

        // Signal talking state END
        if (this.isActive() && window.electronAPI && window.electronAPI.setTalkingState) {
            window.electronAPI.setTalkingState(false);
        }
    }

    async _selectEmotion(system) {
        if (!system.emotionSystem) return;
        // Kick off AI emotion selection (async, sets nextEmotionBuffer)
        system.emotionSystem._selectEmotionFromAI(this.text);
    }

    _triggerEmotionAligned(system, durationMs) {
        if (!system.emotionSystem) return;
        const es = system.emotionSystem;

        if (es.emotionValue >= MessageSession.EMOTION_ALIGN_THRESHOLD) {
            es.triggerAligned(durationMs);
        }
        // If below threshold, don't force — let normal accumulation handle it
    }

    _triggerEmotionIndependent(system) {
        if (!system.emotionSystem) return;
        system.emotionSystem.onAIResponse(this.text);
    }

    static create(text) {
        const session = new MessageSession();
        session.text = text;
        return session;
    }
}

window.MessageSession = MessageSession;
