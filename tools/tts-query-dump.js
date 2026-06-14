// audience: internal
// # tts-query-dump
// 打印一句日语的 audio_query 真实结构,用于核实句内(逐 mora 的 pitch 与 length)与句间(pause_mora)可调点。
// 运行:node tools/tts-query-dump.js

const path = require('path');
const fs = require('fs');
const koffi = require('koffi');
const { VoicevoxBackend } = require('../src/platform/speech/voicevox-backend');

const backend = new VoicevoxBackend({ koffi, path, fs, circuitBreaker: null });
backend.init(path.join(__dirname, '..', 'voicevox_core'), ['0.vvm', '8.vvm'], { gpuMode: false });

const query = backend.audioQuery('今日はいい天気だね。散歩に行こうよ。', 2);
console.log('顶层字段:', Object.keys(query).join(', '));
console.log('accent_phrases 数:', query.accent_phrases.length);
const phrase = query.accent_phrases[0];
console.log('第一句 accent_phrase 字段:', Object.keys(phrase).join(', '));
console.log('第一句 mora 数:', phrase.moras.length);
console.log('第一个 mora:', JSON.stringify(phrase.moras[0]));
console.log('第一句 pause_mora:', JSON.stringify(phrase.pause_mora));
console.log('各句 mora 的 pitch 序列(第一句):', phrase.moras.map((m) => m.pitch.toFixed(2)).join(' '));

backend.dispose();
