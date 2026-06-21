// audience: internal
// # syllabify
// 把作曲的逐音旋律(每音一个 { key, beats })重组为「逐音节」旋律,供歌词演唱:整拍起音开一个音节,其后落在半拍弱位的音并入前一音节作花腔。
// 这样一个汉字唱一个整拍单位(弱位经过音melisma 进同一字),避免一字一音的急促念白感;休止保留以分乐句。
// 输出条目与 song-score 的 buildScore 兼容:单音 { key, beats }、花腔 { notes:[[key,beats],...] }、休止 { rest }。

function syllabify(melody) {
  const out = [];
  let cum = 0;
  let cur = null; // 当前音节累积的 [key, beats] 列表
  const flush = () => {
    if (!cur) return;
    out.push(cur.length === 1 ? { key: cur[0][0], beats: cur[0][1] } : { notes: cur.slice() });
    cur = null;
  };
  for (const e of melody) {
    if (e.rest != null) { flush(); out.push({ rest: e.rest }); cum += e.rest; continue; }
    const onInteger = Math.abs(cum - Math.round(cum)) < 1e-9;
    if (onInteger || !cur) { flush(); cur = [[e.key, e.beats]]; } else { cur.push([e.key, e.beats]); }
    cum += e.beats;
  }
  flush();
  return out;
}

//// 按休止切乐句,数每句的发声音节数,返回 [每句音节数] 与总数 [@x380kkm 2026-06-20] ////
function syllableBudget(singable) {
  const perPhrase = [];
  let n = 0;
  for (const e of singable) {
    if (e.rest != null) { perPhrase.push(n); n = 0; } else n += 1;
  }
  perPhrase.push(n);
  return { perPhrase, total: perPhrase.reduce((a, b) => a + b, 0) };
}
//// /数每句音节数 ////

module.exports = { syllabify, syllableBudget };
