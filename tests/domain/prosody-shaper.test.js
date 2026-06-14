// audience: internal
// # prosody-shaper.test
// 验证韵律塑形:contour 放大或压平句内起伏、pausePad 统一句间停顿、末句句尾按陈述或疑问降升与延长。

const { test } = require('node:test');
const assert = require('node:assert');
const { shape } = require('../../src/domain/tts/prosody-shaper');
const { analyze } = require('../../src/domain/tts/prosody-analyzer');

function mora(pitch, vowelLength = 0.1, consonantLength = 0.05) {
  return { text: 'ア', vowel: 'a', pitch, vowel_length: vowelLength, consonant_length: consonantLength };
}
function phrase(moras, pauseSec = null, interrogative = false) {
  return { moras, accent: 1, pause_mora: pauseSec != null ? mora(0, pauseSec, 0) : null, is_interrogative: interrogative };
}
function query(phrases) {
  return { accent_phrases: phrases, speedScale: 1, pitchScale: 0, prePhonemeLength: 0.1, postPhonemeLength: 0.1 };
}

//// contour 大于 1 放大句内起伏,小于 1 压平 [@busybee 2026-06-14] ////
test('contour 放大或压平句内起伏', () => {
  const moras = () => [mora(5.4), mora(6.0), mora(5.6)];
  const base = analyze(query([phrase(moras())]));
  const lively = analyze(shape(query([phrase(moras())]), { contour: 1.5 }));
  const flat = analyze(shape(query([phrase(moras())]), { contour: 0.5 }));
  assert.ok(lively.pitchStd > base.pitchStd, 'contour 大应起伏更大');
  assert.ok(flat.pitchStd < base.pitchStd, 'contour 小应起伏更小');
});

//// pausePad 把各句句间停顿统一 [@busybee 2026-06-14] ////
test('pausePad 统一句间停顿', () => {
  const q = shape(query([phrase([mora(5.5)], 0.5), phrase([mora(5.6)], 0.1)]), { pausePad: 0.2 });
  assert.ok(Math.abs(q.accent_phrases[0].pause_mora.vowel_length - 0.2) < 1e-9);
  assert.ok(Math.abs(q.accent_phrases[1].pause_mora.vowel_length - 0.2) < 1e-9);
});

//// 陈述句末句尾降并延长,疑问句末句尾升 [@busybee 2026-06-14] ////
test('陈述句末句尾降并延长,疑问句末句尾升', () => {
  const decl = shape(query([phrase([mora(5.5), mora(5.8)])]), { endFall: 0.2, endLengthen: 1.3 });
  const lastDecl = decl.accent_phrases[0].moras[1];
  assert.ok(Math.abs(lastDecl.pitch - 5.6) < 1e-9, '5.8 降 0.2 到 5.6');
  assert.ok(lastDecl.vowel_length > 0.1, '末音节应延长');

  const ques = shape(query([phrase([mora(5.5), mora(5.8)], null, true)]), { endRise: 0.3 });
  assert.ok(ques.accent_phrases[0].moras[1].pitch > 5.8, '疑问句末应升');
});

//// 无 tone 时不改 query [@busybee 2026-06-14] ////
test('无 tone 时不改 query', () => {
  const q = query([phrase([mora(5.5), mora(5.8)])]);
  const before = JSON.stringify(q);
  shape(q, null);
  assert.strictEqual(JSON.stringify(q), before);
});
