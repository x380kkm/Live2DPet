// audience: internal
// # breath
// 气音合成:VOICEVOX 不产生换气声,这里在波形层合成一段很轻的吸气声,供编排器插在断句处,顺带补上停顿。
// 不变量:纯函数无副作用;产出单声道 16 位 PCM(无 WAV 头),采样率随调用方给定;用带种子的伪随机,确定可复现。
//
// 吸气声做法:白噪声经带通(低通减更低的低通,去隆隆声留沙沙气声),再乘吸气包络(渐入到峰、缓降),整体压到很轻。

//// 合成一段吸气气音,返回单声道 16 位 PCM 缓冲 [@busybee 2026-06-14] ////
// opts.durationMs 气音时长;opts.level 峰值幅度(0 到 1,气音很轻);opts.seed 伪随机种子。
function synthBreath(sampleRate, opts = {}) {
  const durationMs = opts.durationMs != null ? opts.durationMs : 350;
  const level = opts.level != null ? opts.level : 0.07;
  let state = (opts.seed != null ? opts.seed : 2463534242) >>> 0;
  // xorshift32 伪随机,落在 [-1,1);带种子故确定可复现。
  const rand = () => {
    state ^= state << 13;
    state ^= state >>> 17;
    state ^= state << 5;
    state >>>= 0;
    return (state / 4294967296) * 2 - 1;
  };

  const n = Math.max(1, Math.floor((sampleRate * durationMs) / 1000));
  const out = Buffer.alloc(n * 2);
  let low = 0;
  let lower = 0;
  for (let i = 0; i < n; i++) {
    const white = rand();
    low += 0.25 * (white - low);
    lower += 0.03 * (low - lower);
    // 带通:留住沙沙的气声,去掉低频隆隆。
    const band = low - lower;
    const t = i / n;
    // 吸气包络:正弦取偏前的幂,渐入到峰、缓降。
    const env = Math.pow(Math.sin(Math.PI * t), 1.2);
    let v = band * env * level * 32767;
    if (v > 32767) v = 32767;
    else if (v < -32768) v = -32768;
    out.writeInt16LE(Math.round(v), i * 2);
  }
  return out;
}
//// /合成一段吸气气音 ////

module.exports = { synthBreath };
