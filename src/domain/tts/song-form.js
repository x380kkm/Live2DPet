// audience: internal
// # song-form
// 把多段乐句拼成一首长曲(主歌-副歌-桥段等),解决「只有三四句、无法发展」的局限:按段落表逐段作曲,副歌等可复用的段只作一次、多处重复,段间严格按小节对齐拼接。
// 每段是一次 composer.compose(各自的风格模型、主音、曲式);非末段开启 breathAtEnd 留段间气口且不破坏小节对齐。返回整首的 melody、和弦跨度(带每段主音)、段落表与总小节数。
// 输出与单段一致:melody 为发声音符 { key, beats } 与换气 { rest };和弦跨度 { startBeat, beats, root, pcs, tonic },tonic 为该段主音(不同段可不同调,如桥段转关系小调)。

const { compose } = require('./composer');

const BEATS_PER_BAR = 4;

//// 把段落表拼成整首长曲:可复用段(同 key)只作一次,逐段按小节对齐拼接 [@x380kkm 2026-06-20] ////
// sections: [{ role, key?, style, tonicMidi, seed, phrases?, barsPerPhrase?, form? }]
//   role 段落名(verse/chorus/bridge 等),key 复用键(同 key 复用同一段乐句,缺省用 role),seed 经 makeRng 转随机源。
// makeRng(seed) 由调用方注入,返回可重复随机源,保证整首可复现。
function composeSong(sections, makeRng) {
  const built = {};
  const melody = [];
  const chords = [];
  const layout = [];
  let cum = 0;
  sections.forEach((sec) => {
    const key = sec.key || sec.role;
    if (!built[key]) {
      const part = compose({
        style: sec.style,
        tonicMidi: sec.tonicMidi,
        rng: makeRng(sec.seed),
        phrases: sec.phrases || 4,
        barsPerPhrase: sec.barsPerPhrase || 2,
        form: sec.form,
        breathAtEnd: true, // 段内末句也留气口,使段与段之间有换气;拼接时按需删掉整首最后一个气口
      });
      built[key] = part;
    }
    const part = built[key];
    const partBeats = part.melody.reduce((a, e) => a + (e.rest != null ? e.rest : e.beats), 0);
    const sungInSec = part.melody.filter((e) => e.rest == null).length;
    // 复制该段旋律与和弦,和弦起拍按当前累计偏移,记下该段主音供和弦命名;每段含段尾气口,整首严格按小节对齐。
    part.melody.forEach((e) => {
      melody.push(e.rest != null ? { rest: e.rest } : { key: e.key, beats: e.beats });
    });
    part.chords.forEach((c) => {
      chords.push({ startBeat: cum + c.startBeat, beats: c.beats, root: c.root, pcs: c.pcs, tonic: sec.tonicMidi });
    });
    layout.push({ role: sec.role, key, groove: sec.groove, tonic: sec.tonicMidi, bars: partBeats / BEATS_PER_BAR, sung: sungInSec });
    cum += partBeats;
  });
  return { melody, chords, layout, totalBars: cum / BEATS_PER_BAR, parts: built };
}
//// /把段落表拼成整首长曲 ////

module.exports = { composeSong };
