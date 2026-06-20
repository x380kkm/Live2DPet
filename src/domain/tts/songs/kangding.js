// audience: internal
// # kangding
// 演示曲目「康定情歌」(四川民歌)首段的歌词与旋律,供中文歌唱合成做示范与测试。
// 旋律按维基百科 \relative \time 2/4 \key f \major 的 LilyPond 谱解析而来:音名加拍数(一拍为四分音符),
// 连音线标的花腔以 { notes:[[音名,拍数],...] } 表一字唱多音;发声条目按序对应歌词逐字。
// 来源:https://zh.wikipedia.org/wiki/康定情歌 内嵌乐谱。

// 歌词逐字对应下方 melody 的发声条目,共 39 字
const lyrics = '跑马溜溜的山上一朵溜溜的云哟端端溜溜的照在康定溜溜的城哟月亮弯弯康定溜溜的城哟';

// 速度:每分钟 78 拍(原谱 \tempo 4 = 78)
const bpm = 78;

// 旋律条目:发声音符 { note:音名, beats:拍数 }、花腔 { notes:[[音名,拍数],...] }
const melody = [
  // 跑马溜溜的山上一朵溜溜的云哟
  { note: 'A4', beats: 0.5 },
  { note: 'C5', beats: 0.5 },
  { note: 'D5', beats: 0.5 },
  { note: 'D5', beats: 0.25 },
  { note: 'C5', beats: 0.25 },
  { notes: [['D5', 0.75], ['A4', 0.25]] },
  { note: 'G4', beats: 1 },
  { note: 'A4', beats: 0.5 },
  { note: 'C5', beats: 0.5 },
  { note: 'D5', beats: 0.5 },
  { note: 'D5', beats: 0.25 },
  { note: 'C5', beats: 0.25 },
  { note: 'D5', beats: 0.5 },
  { note: 'A4', beats: 1.5 },
  // 端端溜溜的照在康定溜溜的城哟
  { note: 'A4', beats: 0.5 },
  { note: 'C5', beats: 0.5 },
  { note: 'D5', beats: 0.5 },
  { note: 'D5', beats: 0.25 },
  { note: 'C5', beats: 0.25 },
  { notes: [['D5', 0.5], ['A4', 0.5]] },
  { note: 'G4', beats: 1 },
  { note: 'C5', beats: 0.5 },
  { note: 'A4', beats: 0.5 },
  { notes: [['G4', 0.25], ['A4', 0.25]] },
  { note: 'G4', beats: 0.25 },
  { note: 'F4', beats: 0.25 },
  { note: 'G4', beats: 0.5 },
  { note: 'D4', beats: 1.5 },
  // 月亮弯弯康定溜溜的城哟
  { note: 'D4', beats: 0.5 },
  { note: 'G4', beats: 1.5 },
  { notes: [['C5', 0.5], ['A4', 1.5]] },
  { notes: [['G4', 0.25], ['F4', 0.25], ['D4', 1.5]] },
  { note: 'C5', beats: 0.5 },
  { note: 'A4', beats: 0.5 },
  { notes: [['G4', 0.25], ['A4', 0.25]] },
  { note: 'G4', beats: 0.25 },
  { note: 'F4', beats: 0.25 },
  { note: 'G4', beats: 0.5 },
  { note: 'D4', beats: 1.5 },
];

module.exports = { lyrics, bpm, melody };
