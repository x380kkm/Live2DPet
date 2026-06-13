// 运行: node --test tests/domain/keyframe-buffer.test.js
// 用 mock 注入 downsample 与时钟,断言多层环形缓冲的级联下沉、按龄降采样与淘汰、清空。

const { test } = require('node:test');
const assert = require('node:assert');
const { KeyframeBuffer } = require('../../src/domain/perception/keyframe-buffer');

//// 假 downsample:记录每次调用的目标边长,返回标注分辨率的帧数据 [@busybee 2026-06-13] ////
function fakeDownsample() {
  const calls = [];
  const fn = async (image, maxDim) => {
    calls.push({ image, maxDim });
    return `${image}@${maxDim}`;
  };
  fn.calls = calls;
  return fn;
}

//// 可控时钟:读 ref.value 作当前时刻 [@busybee 2026-06-13] ////
function fakeClock(ref) {
  return () => ref.value;
}

test('push 把溢出帧级联降采样下沉到更低层', async () => {
  const downsample = fakeDownsample();
  const buf = new KeyframeBuffer({ downsample, now: () => 0 });
  // 默认三层各持一帧,推三帧后层 0 持最新,前两帧依次下沉。
  await buf.push({ image: 'a', timestamp: 1 });
  await buf.push({ image: 'b', timestamp: 2 });
  await buf.push({ image: 'c', timestamp: 3 });

  assert.strictEqual(buf.size(), 3);
  assert.strictEqual(buf.levels[0][0].image, 'c');
  // 'b' 下沉到层 1(512*0.5=256);'a' 先沉到层 1 再沉到层 2,级联降采样两次。
  assert.strictEqual(buf.levels[1][0].image, 'b@256');
  assert.strictEqual(buf.levels[2][0].image, 'a@256@128');
});

test('push 最低层超额时丢弃最旧帧', async () => {
  const buf = new KeyframeBuffer({ downsample: fakeDownsample(), now: () => 0 });
  for (const img of ['a', 'b', 'c', 'd', 'e']) {
    await buf.push({ image: img, timestamp: 1 });
  }
  // 三层各容一帧,总量恒为 3。
  assert.strictEqual(buf.size(), 3);
});

test('push 忽略空帧', async () => {
  const buf = new KeyframeBuffer({ downsample: fakeDownsample() });
  await buf.push(null);
  await buf.push({ timestamp: 1 });
  assert.strictEqual(buf.size(), 0);
});

test('sample 淘汰超 maxAgeMs 的帧', async () => {
  const clock = { value: 0 };
  const buf = new KeyframeBuffer({ downsample: fakeDownsample(), now: fakeClock(clock) });
  await buf.push({ image: 'old', timestamp: 0, resolution: 128 });
  clock.value = 700000; // 超过默认 maxAgeMs=600000
  const frames = await buf.sample();
  assert.strictEqual(frames.length, 0);
  assert.strictEqual(buf.size(), 0);
});

test('sample 按年龄降采样:越旧目标分辨率越低', async () => {
  const clock = { value: 0 };
  const downsample = fakeDownsample();
  const buf = new KeyframeBuffer({ downsample, now: fakeClock(clock) });
  await buf.push({ image: 'frame', timestamp: 0, resolution: 512 });
  clock.value = 400000; // 落入 >300000 档,目标 128
  const frames = await buf.sample();
  assert.strictEqual(frames.length, 1);
  assert.strictEqual(frames[0].resolution, 128);
  assert.strictEqual(frames[0].image, 'frame@128');
});

test('sample 已达目标分辨率不再降采样', async () => {
  const clock = { value: 0 };
  const downsample = fakeDownsample();
  const buf = new KeyframeBuffer({ downsample, now: fakeClock(clock) });
  await buf.push({ image: 'frame', timestamp: 0, resolution: 128 });
  clock.value = 60000; // 落入 <=120000 档,目标 512,而当前已是 128
  await buf.sample();
  assert.strictEqual(downsample.calls.length, 0);
});

test('sample 最新帧在前并按 maxCount 截断', async () => {
  const clock = { value: 0 };
  const buf = new KeyframeBuffer({ downsample: fakeDownsample(), now: fakeClock(clock) });
  await buf.push({ image: 'a', timestamp: 10, resolution: 128 });
  await buf.push({ image: 'b', timestamp: 20, resolution: 128 });
  await buf.push({ image: 'c', timestamp: 30, resolution: 128 });
  clock.value = 30;
  const frames = await buf.sample(2);
  assert.strictEqual(frames.length, 2);
  assert.strictEqual(frames[0].timestamp, 30);
  assert.strictEqual(frames[1].timestamp, 20);
});

test('clear 清空各层', async () => {
  const buf = new KeyframeBuffer({ downsample: fakeDownsample(), now: () => 0 });
  await buf.push({ image: 'a', timestamp: 1 });
  buf.clear();
  assert.strictEqual(buf.size(), 0);
});
