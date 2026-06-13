// 用 mock 注入断言 image-renderer 的行为契约,不触真实 DOM 与全局。
const { test } = require('node:test');
const assert = require('node:assert');
const { ImageRenderer } = require('../../src/platform/render/image-renderer');

// 造一个最小的假图片元素,记录 src 与 display
function makeFakeImage() {
  return { src: '', style: { display: 'block' } };
}

// 分帧模式配置:每个池只放一个文件,使随机选取结果确定
function folderConfig() {
  return {
    imageFolderPath: 'C:\\pets\\cat',
    imageFiles: [
      { file: 'idle.png', idle: true },
      { file: 'talk.png', talking: true },
      { file: 'happy.png', emotionName: 'happy' }
    ]
  };
}

test('分帧模式构造时把文件按用途分进三类池', () => {
  const image = makeFakeImage();
  const renderer = new ImageRenderer({ imageElement: image, config: folderConfig() });
  assert.deepStrictEqual(renderer.idleImages, ['idle.png']);
  assert.deepStrictEqual(renderer.talkingImages, ['talk.png']);
  assert.deepStrictEqual(renderer.emotionImages, { happy: ['happy.png'] });
});

test('分帧模式构造后默认显示空闲帧,路径转成 file:// 且文件名编码', () => {
  const image = makeFakeImage();
  new ImageRenderer({ imageElement: image, config: folderConfig() });
  assert.strictEqual(image.src, 'file:///C:/pets/cat/idle.png');
});

test('playAction 在分帧模式按情绪名优先于说话与空闲显示情绪帧', () => {
  const image = makeFakeImage();
  const renderer = new ImageRenderer({ imageElement: image, config: folderConfig() });
  renderer.setTalking(true);
  renderer.playAction('happy');
  assert.strictEqual(image.src, 'file:///C:/pets/cat/happy.png');
});

test('setTalking 在无情绪时按说话状态切换空闲与说话帧', () => {
  const image = makeFakeImage();
  const renderer = new ImageRenderer({ imageElement: image, config: folderConfig() });
  renderer.setTalking(true);
  assert.strictEqual(image.src, 'file:///C:/pets/cat/talk.png');
  renderer.setTalking(false);
  assert.strictEqual(image.src, 'file:///C:/pets/cat/idle.png');
});

test('revertAction 在分帧模式清除情绪、回到常态帧', () => {
  const image = makeFakeImage();
  const renderer = new ImageRenderer({ imageElement: image, config: folderConfig() });
  renderer.playAction('happy');
  renderer.revertAction();
  assert.strictEqual(renderer.currentEmotion, null);
  assert.strictEqual(image.src, 'file:///C:/pets/cat/idle.png');
});

test('旧模式 playAction 查 gifExpressions 表切换图片', () => {
  const image = makeFakeImage();
  const renderer = new ImageRenderer({
    imageElement: image,
    config: { gifExpressions: { happy: 'happy.gif' }, staticImagePath: 'idle.png' }
  });
  assert.strictEqual(renderer.folderMode, false);
  renderer.playAction('happy');
  assert.strictEqual(image.src, 'happy.gif');
});

test('旧模式 revertAction 回到静态图片', () => {
  const image = makeFakeImage();
  const renderer = new ImageRenderer({
    imageElement: image,
    config: { gifExpressions: { happy: 'happy.gif' }, staticImagePath: 'idle.png' }
  });
  renderer.playAction('happy');
  renderer.revertAction();
  assert.strictEqual(image.src, 'idle.png');
});

test('setMouth 不改帧,保持现有静图切换行为', () => {
  const image = makeFakeImage();
  const renderer = new ImageRenderer({ imageElement: image, config: folderConfig() });
  const before = image.src;
  renderer.setMouth(0.8);
  assert.strictEqual(image.src, before);
});

test('hitTest 图片模式恒返回空', () => {
  const image = makeFakeImage();
  const renderer = new ImageRenderer({ imageElement: image, config: folderConfig() });
  assert.strictEqual(renderer.hitTest({ x: 1, y: 2 }), null);
});

test('dispose 清空图片元素并隐藏', () => {
  const image = makeFakeImage();
  const renderer = new ImageRenderer({ imageElement: image, config: folderConfig() });
  renderer.dispose();
  assert.strictEqual(image.src, '');
  assert.strictEqual(image.style.display, 'none');
});
