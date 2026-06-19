// audience: internal
// # molihua
// 演示曲目「茉莉花」(江苏民歌)首段的歌词与旋律,供中文歌唱合成做示范。
// 旋律按维基百科 \relative c' \key c \major \time 2/2 的 LilyPond 谱解析而来:音名加拍数(一拍为四分音符),
// 连音线标的花腔以 { notes:[[音名,拍数],...] } 表一字唱多音;发声条目按序对应歌词逐字,首句「好一朵美丽的茉莉花」依原谱反复唱两遍。
// 来源:https://en.wikipedia.org/wiki/Mo_Li_Hua 内嵌乐谱。

// 歌词逐字对应下方 melody 的发声条目,共 51 字(首句反复一次)
const lyrics = '好一朵美丽的茉莉花好一朵美丽的茉莉花芬芳美丽满枝桠又香又白人人夸让我来将你摘下送给别人家茉莉花呀茉莉花';

// 速度:每分钟 88 拍
const bpm = 88;

// 旋律条目:发声音符 { note:音名, beats:拍数 }、花腔 { notes:[[音名,拍数],...] }、休止 { rest:拍数 }
const melody = [
  // 好一朵美丽的茉莉花
  { note: 'E4', beats: 1 },
  { note: 'E4', beats: 0.5 },
  { note: 'G4', beats: 0.5 },
  { notes: [['A4', 0.5], ['C5', 0.5]] },
  { note: 'C5', beats: 0.5 },
  { note: 'A4', beats: 0.5 },
  { note: 'G4', beats: 1 },
  { notes: [['G4', 0.5], ['A4', 0.5]] },
  { note: 'G4', beats: 1 },
  { rest: 1 },
  // 好一朵美丽的茉莉花(反复)
  { note: 'E4', beats: 1 },
  { note: 'E4', beats: 0.5 },
  { note: 'G4', beats: 0.5 },
  { notes: [['A4', 0.5], ['C5', 0.5]] },
  { note: 'C5', beats: 0.5 },
  { note: 'A4', beats: 0.5 },
  { note: 'G4', beats: 1 },
  { notes: [['G4', 0.5], ['A4', 0.5]] },
  { note: 'G4', beats: 1 },
  { rest: 1 },
  // 芬芳美丽满枝桠
  { note: 'G4', beats: 1 },
  { note: 'G4', beats: 1 },
  { note: 'G4', beats: 1 },
  { notes: [['E4', 0.5], ['G4', 0.5]] },
  { note: 'A4', beats: 1 },
  { note: 'A4', beats: 1 },
  { rest: 0.03 }, // 枝、桠 之间的极短换气,断开 ジ 尾与 イ 首相同元音的粘连
  { note: 'G4', beats: 2 },
  // 又香又白人人夸
  { note: 'E4', beats: 1 },
  { notes: [['D4', 0.5], ['E4', 0.5]] },
  { note: 'G4', beats: 1 },
  { notes: [['E4', 0.5], ['D4', 0.5]] },
  { note: 'C4', beats: 1 },
  { notes: [['C4', 0.5], ['D4', 0.5]] },
  { note: 'C4', beats: 2 },
  // 让我来将你摘下
  { notes: [['E4', 0.5], ['D4', 0.5]] },
  { notes: [['C4', 0.5], ['E4', 0.5]] },
  { note: 'D4', beats: 1.5 },
  { note: 'E4', beats: 0.5 },
  { note: 'G4', beats: 1 },
  { notes: [['A4', 0.5], ['C5', 0.5]] },
  { note: 'G4', beats: 2 },
  // 送给别人家
  { note: 'D4', beats: 1 },
  { notes: [['E4', 0.5], ['G4', 0.5]] },
  { notes: [['D4', 0.5], ['E4', 0.5]] },
  { notes: [['C4', 0.5], ['A3', 0.5]] },
  { note: 'G3', beats: 2 },
  // 茉莉花呀茉莉花
  { note: 'A3', beats: 1 },
  { note: 'C4', beats: 1 },
  { note: 'D4', beats: 1.5 },
  { note: 'E4', beats: 0.5 },
  { notes: [['C4', 0.5], ['D4', 0.5]] },
  { notes: [['C4', 0.5], ['A3', 0.5]] },
  { note: 'G3', beats: 2 },
  { rest: 2 },
];

module.exports = { lyrics, bpm, melody };
