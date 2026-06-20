// audience: internal
// # dongfanghong
// 演示曲目「东方红」(陕北调)首段的歌词与旋律,供中文歌唱合成做示范与测试。
// 旋律按 ESAC 民歌集的 ABC 谱解析而来(C 大调、2/4、♩=100):音名加拍数,花腔以 { notes:[[音名,拍数],...] } 表一字唱多音。
// ABC 谱不含歌词,逐字与花腔的对齐按这首歌的通行唱法手工标注(乐句末长音归到该字)。
// 来源:abcnotation.com ESAC 中文子集。

// 歌词逐字对应下方 melody 的发声条目,共 32 字
const lyrics = '东方红太阳升中国出了个毛泽东他为人民谋幸福呼儿嗨哟他是人民大救星';

// 速度:每分钟 100 拍(原谱 Q:1/4=100)
const bpm = 100;

// 旋律条目:发声音符 { note:音名, beats:拍数 }、花腔 { notes:[[音名,拍数],...] }
const melody = [
  // 东方红,太阳升
  { note: 'C5', beats: 1 },                       // 东
  { note: 'C5', beats: 0.5 },                     // 方
  { notes: [['D5', 0.5], ['G4', 2]] },            // 红
  { note: 'F4', beats: 1 },                       // 太
  { note: 'F4', beats: 0.5 },                     // 阳
  { notes: [['D4', 0.5], ['G4', 2]] },            // 升
  // 中国出了个毛泽东
  { note: 'C5', beats: 1 },                       // 中
  { note: 'C5', beats: 0.5 },                     // 国
  { note: 'C5', beats: 0.5 },                     // 出
  { note: 'D5', beats: 0.5 },                     // 了
  { note: 'F5', beats: 0.5 },                     // 个
  { note: 'D5', beats: 0.5 },                     // 毛
  { note: 'C5', beats: 0.5 },                     // 泽
  { notes: [['F5', 1], ['F4', 0.5], ['D4', 0.5], ['G4', 2]] }, // 东
  // 他为人民谋幸福
  { note: 'C5', beats: 1 },                       // 他
  { note: 'G4', beats: 1 },                       // 为
  { note: 'F4', beats: 0.5 },                     // 人
  { note: 'F4', beats: 0.5 },                     // 民
  { note: 'E4', beats: 0.5 },                     // 谋
  { note: 'D4', beats: 0.5 },                     // 幸
  { note: 'C4', beats: 1 },                       // 福
  // 呼儿嗨哟
  { note: 'C5', beats: 1 },                       // 呼
  { note: 'G4', beats: 1 },                       // 儿
  { note: 'A4', beats: 0.5 },                     // 嗨
  { note: 'G4', beats: 0.5 },                     // 哟
  // 他是人民大救星
  { note: 'F4', beats: 1 },                       // 他
  { notes: [['F4', 0.5], ['D4', 0.5]] },          // 是
  { note: 'G4', beats: 0.5 },                     // 人
  { notes: [['A4', 0.5], ['G4', 0.5]] },          // 民
  { notes: [['F4', 0.5], ['G4', 0.5]] },          // 大
  { notes: [['F4', 0.5], ['E4', 0.5], ['D4', 0.5]] }, // 救
  { note: 'C4', beats: 3 },                       // 星
];

module.exports = { lyrics, bpm, melody };
