// audience: internal
// # keyframe-buffer
// 关键帧环形缓冲与按龄降采样:接收帧、按年龄降采样、对外给出当前关键帧集。
// 不变量:缓冲只持有帧数据本身,不解析态势;原生图像在采集后由调用方主动释放。

const UNIMPLEMENTED = '未实现,见目标架构设计第七节迁移里程碑';

class KeyframeBuffer {
  // 写入一帧
  push(frame) {
    throw new Error(UNIMPLEMENTED);
  }

  // 按年龄降采样后返回当前关键帧集
  sample() {
    throw new Error(UNIMPLEMENTED);
  }

  // 清空缓冲
  clear() {
    throw new Error(UNIMPLEMENTED);
  }
}

module.exports = { KeyframeBuffer };
