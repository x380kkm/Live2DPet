// audience: internal
// # breath.test
// 验证气音合成:产出正确长度的单声道 16 位 PCM、非全零、同种子可复现、时长越长 PCM 越长。

const { test } = require('node:test');
const assert = require('node:assert');
const { synthBreath } = require('../../src/domain/tts/breath');

//// 产出正确长度的非全零 PCM [@busybee 2026-06-14] ////
test('synthBreath 产出正确长度的非全零 PCM', () => {
  const pcm = synthBreath(24000, { durationMs: 300 });
  assert.strictEqual(pcm.length, 24000 * 0.3 * 2, '长度应为采样数乘 2 字节');
  let nonZero = false;
  for (let i = 0; i < pcm.length; i += 2) {
    if (pcm.readInt16LE(i) !== 0) {
      nonZero = true;
      break;
    }
  }
  assert.ok(nonZero, '气音不应全为静音');
});

//// 同种子可复现,不同种子不同 [@busybee 2026-06-14] ////
test('synthBreath 同种子可复现,不同种子不同', () => {
  const a = synthBreath(24000, { seed: 7 });
  const b = synthBreath(24000, { seed: 7 });
  const c = synthBreath(24000, { seed: 8 });
  assert.ok(a.equals(b), '同种子应一致');
  assert.ok(!a.equals(c), '不同种子应不同');
});

//// 时长越长 PCM 越长 [@busybee 2026-06-14] ////
test('synthBreath 时长越长 PCM 越长', () => {
  assert.ok(synthBreath(24000, { durationMs: 400 }).length > synthBreath(24000, { durationMs: 200 }).length);
});
