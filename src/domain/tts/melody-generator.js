// audience: internal
// # melody-generator
// 旋律生成的兼容入口：统一作曲架构已迁到 composer，本文件只保留既有调用方用的薄包装。
// generateMelody 委托 composer.compose，仅取其旋律数组（发声音符 { key:MIDI, beats }、换气 { rest }），与 song-score 旋律格式一致；
// 需要和弦骨架与配器协调时，直接用 composer.compose 取 { melody, chords }。

const { compose, loadModel, snapToScale, SCALES } = require('./composer');

//// 离线随机生成一段旋律：委托统一作曲架构，只返回旋律数组 [@x380kkm 2026-06-20] ////
function generateMelody(options = {}) {
  return compose(options).melody;
}
//// /离线随机生成一段旋律 ////

module.exports = { generateMelody, loadModel, snapToScale, SCALES };
