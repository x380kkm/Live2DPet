// audience: internal
// # keyframe-buffer
// 关键帧环形缓冲与按龄降采样:接收帧、按年龄降采样、对外给出当前关键帧集。
// 不变量:缓冲只持有帧数据本身,不解析态势;原生图像在采集后由调用方主动释放。
//
// 多层环形缓冲:层 0 持最新满分辨率,溢出帧级联降采样下沉到更低层。
// 帧形如 { image, timestamp, title, resolution };image 为不透明帧数据(如 base64),本模块不解读其内容。
// 降采样经构造注入的 downsample(image, maxDim) 完成,DOM 与画布细节不进本层。
// sample 按年龄进一步降采样并淘汰过旧帧;age 与 resolution 阈值经构造给定。

//// 缺省层级表:满、半、四分之一三层,各持一帧 [@busybee 2026-06-13] ////
function defaultLevels() {
  return [
    { scale: 1.0, maxSize: 1 },
    { scale: 0.5, maxSize: 1 },
    { scale: 0.25, maxSize: 1 }
  ];
}
//// /缺省层级表 ////

//// 缺省按龄降采样档:越旧目标分辨率越低,超 maxAgeMs 淘汰 [@busybee 2026-06-13] ////
function defaultAgeLadder() {
  return {
    baseResolution: 512,
    maxAgeMs: 600000,
    steps: [
      { withinMs: 120000, resolution: 512 },
      { withinMs: 300000, resolution: 256 },
      { withinMs: Infinity, resolution: 128 }
    ]
  };
}
//// /缺省按龄降采样档 ////

class KeyframeBuffer {
  //// 构造注入降采样函数、时钟、层级表与按龄档,装配各层的帧数组 [@busybee 2026-06-13] ////
  constructor(deps = {}, config = {}) {
    // downsample(image, maxDim) 产出降采样后的帧数据;缺省恒等,便于无图像环境测试。
    this.downsample = deps.downsample || ((image) => image);
    this.now = deps.now || (() => Date.now());

    this.levelSpecs = config.levels || defaultLevels();
    this.ageLadder = config.ageLadder || defaultAgeLadder();
    this.baseResolution = this.ageLadder.baseResolution;

    // 每层一个帧数组,索引与 levelSpecs 对齐。
    this.levels = this.levelSpecs.map(() => []);
  }
  //// /构造注入降采样函数、时钟、层级表与按龄档 ////

  //// 写入一帧:落入层 0,逐层把溢出帧降采样下沉,最低层超额则丢最旧 [@busybee 2026-06-13] ////
  async push(frame) {
    if (!frame || frame.image == null) return;
    const entry = {
      image: frame.image,
      timestamp: frame.timestamp != null ? frame.timestamp : this.now(),
      title: frame.title,
      resolution: frame.resolution != null ? frame.resolution : this.baseResolution
    };
    this.levels[0].push(entry);

    for (let i = 0; i < this.levels.length - 1; i++) {
      const current = this.levels[i];
      const next = this.levels[i + 1];
      const nextScale = this.levelSpecs[i + 1].scale;
      while (current.length > this.levelSpecs[i].maxSize) {
        const overflow = current.shift();
        const maxDim = Math.round(this.baseResolution * nextScale);
        overflow.image = await this.downsample(overflow.image, maxDim);
        overflow.resolution = maxDim;
        next.push(overflow);
      }
    }

    const last = this.levels[this.levels.length - 1];
    while (last.length > this.levelSpecs[this.levels.length - 1].maxSize) {
      last.shift();
    }
  }
  //// /写入一帧 ////

  //// 按年龄降采样后返回当前关键帧集:淘汰过旧帧,越旧分辨率越低,最新在前 [@busybee 2026-06-13] ////
  async sample(maxCount = Infinity) {
    const now = this.now();
    const kept = [];
    for (const level of this.levels) {
      const survivors = [];
      for (const entry of level) {
        const ageMs = now - entry.timestamp;
        if (ageMs > this.ageLadder.maxAgeMs) continue;
        const target = this._targetResolution(ageMs);
        if (entry.resolution > target) {
          entry.image = await this.downsample(entry.image, target);
          entry.resolution = target;
        }
        survivors.push(entry);
      }
      // 原位收缩本层,过旧帧不再保留。
      level.length = 0;
      for (const s of survivors) level.push(s);
      kept.push(...survivors);
    }
    kept.sort((a, b) => b.timestamp - a.timestamp);
    return maxCount === Infinity ? kept : kept.slice(0, maxCount);
  }
  //// /按年龄降采样后返回当前关键帧集 ////

  //// 按年龄在档位里查目标分辨率:取第一个年龄落入其窗的档 [@busybee 2026-06-13] ////
  _targetResolution(ageMs) {
    for (const step of this.ageLadder.steps) {
      if (ageMs <= step.withinMs) return step.resolution;
    }
    return this.ageLadder.steps[this.ageLadder.steps.length - 1].resolution;
  }

  //// 当前各层帧总数 [@busybee 2026-06-13] ////
  size() {
    return this.levels.reduce((sum, level) => sum + level.length, 0);
  }

  //// 清空缓冲:各层置空 [@busybee 2026-06-13] ////
  clear() {
    for (const level of this.levels) level.length = 0;
  }
}

module.exports = { KeyframeBuffer };
