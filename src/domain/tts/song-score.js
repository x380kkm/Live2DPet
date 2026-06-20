// audience: internal
// # song-score
// 中文歌唱的曲谱拼装层:把中文歌词与旋律拼成 VOICEVOX 歌唱所需的 Score(音符序列)。
// 借鉴 chinese-speak 的拼音结构知识(主元音即韵腹、介音与韵尾短),但歌唱自成一套简化时值逻辑:不做语调与音量塑形,只把正确的元音放到正确的长度与位置。
// 旋律供音高与每字时值;一字一音时按 mora 的角色分时长(韵腹占主、介音与韵尾短),一字多音(花腔)时逐音符摊 mora、音符多于 mora 则余下音符延续韵腹元音。
// VOICEVOX 歌唱每个音符的歌词须恰为一个 mora。不变量:纯逻辑无副作用;发声条目数须等于歌词音节数;每秒 93.75 帧由 VOICEVOX 固定。
// 第三方 pinyin-pro 不在此出现,逐字拼音经 chinese-text 取得,守住「拼音库只在 chinese-text」的边界。

const { textToPinyinTokens } = require('./chinese-text');
const { parsePinyin, syllableToKana } = require('./pinyin-kana');
const { COMBINING, BASE_VOWEL } = require('./chinese-tables');

// VOICEVOX 歌唱的固定帧率:每秒 93.75 帧,等于采样率 24000 除以每帧 256 个采样点
const FRAMES_PER_SECOND = 24000 / 256;
// 一字一音时各 mora 的时值:韵腹(主元音)延音吃掉音符其余时长,韵腹前的起音介音与韵腹后的滑尾鼻韵尾各取固定短时长(像辅音一样、不随音符变长)。
const ONSET_MS = 70;  // 韵腹前的介音、零声母起音的目标时长(毫秒)
const CODA_MS = 100;  // 韵腹后的滑尾、鼻韵尾的目标时长(毫秒)
const MAX_SHORT_FRACTION = 0.35; // 短音符上每个短拍最多占的比例,避免短音符被起音韵尾挤掉韵腹
// 音名到半音序号:C 记 0,十二平均律按此推 MIDI 音高
const SEMITONE = { C: 0, D: 2, E: 4, F: 5, G: 7, A: 9, B: 11 };
// 主元音响度序:定位韵腹时,无字面匹配则取最响的元音那一拍
const SONORITY = { a: 5, o: 4, e: 3, u: 2, i: 1 };

// 片假名到其元音假名:花腔延音取一个 mora 末字的元音延续发声;鼻音 ン 延续仍发鼻音
const VOWEL_KANA = (() => {
  const groups = {
    ア: 'アカサタナハマヤラワガザダバパ',
    イ: 'イキシチニヒミリギジヂビピ',
    ウ: 'ウクスツヌフムユルグズヅブプヴ',
    エ: 'エケセテネヘメレゲゼデベペ',
    オ: 'オコソトノホモヨロヲゴゾドボポ',
  };
  const map = { ァ: 'ア', ィ: 'イ', ゥ: 'ウ', ェ: 'エ', ォ: 'オ', ャ: 'ア', ュ: 'ウ', ョ: 'オ' };
  for (const [vowel, chars] of Object.entries(groups)) for (const ch of chars) map[ch] = vowel;
  return map;
})();

//// 把音名(如 E4、A#4、Bb3)转成 MIDI 音高,C4 记 60;已是数字则原样返回 [@x380kkm 2026-06-20] ////
function noteNameToMidi(name) {
  if (typeof name === 'number') return name;
  const m = String(name).trim().match(/^([A-Ga-g])([#b]?)(-?\d+)$/);
  if (!m) throw new Error(`无法解析音名:${name}`);
  const semitone = SEMITONE[m[1].toUpperCase()] + (m[2] === '#' ? 1 : m[2] === 'b' ? -1 : 0);
  const octave = parseInt(m[3], 10);
  return 12 * (octave + 1) + semitone;
}
//// /把音名转成 MIDI 音高 ////

//// 把拍数按速度换成帧数,至少 1 帧 [@x380kkm 2026-06-20] ////
// 一拍记为四分音符;bpm 为每分钟拍数,故每拍秒数为 60/bpm,乘帧率得帧数。
function beatsToFrames(beats, bpm) {
  return Math.max(1, Math.round(beats * FRAMES_PER_SECOND * 60 / bpm));
}
//// /把拍数按速度换成帧数 ////

//// 把片假名串按 mora 切开:小书写假名并入前一个 mora,其余各自成 mora [@x380kkm 2026-06-20] ////
function splitMoras(kana) {
  const moras = [];
  for (const ch of kana) {
    if (COMBINING.has(ch) && moras.length > 0) {
      moras[moras.length - 1] += ch;
    } else {
      moras.push(ch);
    }
  }
  return moras;
}
//// /把片假名串按 mora 切开 ////

//// 取一个 mora 的元音假名,供花腔延音;鼻音 ン 延续仍发 ン [@x380kkm 2026-06-20] ////
function vowelOf(mora) {
  const last = Array.from(mora).pop();
  if (last === 'ン') return 'ン';
  return VOWEL_KANA[last] || last;
}
//// /取一个 mora 的元音假名 ////

//// 取一个 mora 的元音字母(a/i/u/e/o),鼻音回 n [@x380kkm 2026-06-20] ////
function moraVowelLetter(mora) {
  const v = vowelOf(mora);
  return v === 'ン' ? 'n' : (BASE_VOWEL[v] || '');
}
//// /取一个 mora 的元音字母 ////

//// 取一个拼音韵母的主元音字母:去鼻韵尾与儿尾后,按响度优先取一个元音 [@x380kkm 2026-06-20] ////
function nucleusVowelOfFinal(final) {
  const body = String(final).replace(/(ng|n|r)$/, '');
  for (const v of ['a', 'o', 'ê', 'e', 'u', 'i', 'ü']) if (body.includes(v)) return v;
  return body[body.length - 1] || 'a';
}
//// /取一个拼音韵母的主元音字母 ////

//// 定位音节的韵腹 mora:取元音字母与韵母主元音相符的那拍(介音在前故取最后一个匹配),无匹配则取最响的元音拍 [@x380kkm 2026-06-20] ////
function nucleusIndex(parsed, moras) {
  if (moras.length <= 1) return 0;
  const target = nucleusVowelOfFinal(parsed.final);
  const letters = moras.map(moraVowelLetter);
  const matched = letters.lastIndexOf(target);
  if (matched >= 0) return matched;
  let best = 0;
  let bestScore = -1;
  letters.forEach((letter, i) => {
    const score = SONORITY[letter] || 0;
    if (score >= bestScore) { bestScore = score; best = i; }
  });
  return best;
}
//// /定位音节的韵腹 mora ////

//// 把一拍音符的总帧数分给各 mora:指定韵腹拍延音、其余拍取固定短时长(上限封顶) [@x380kkm 2026-06-20] ////
// 韵腹前的拍按 ONSET_MS、韵腹后的拍按 CODA_MS 折成帧,各自不超过音符的 MAX_SHORT_FRACTION;韵腹拍吃掉剩余,至少 1 帧。
function allocateWithNucleus(nucleusAt, moras, totalFrames) {
  if (moras.length <= 1) return [totalFrames];
  const shortCap = Math.max(1, Math.floor(totalFrames * MAX_SHORT_FRACTION));
  const out = new Array(moras.length).fill(0);
  let used = 0;
  for (let i = 0; i < moras.length; i++) {
    if (i === nucleusAt) continue;
    const ms = i < nucleusAt ? ONSET_MS : CODA_MS;
    const target = Math.round(ms / 1000 * FRAMES_PER_SECOND);
    out[i] = Math.min(target, shortCap);
    used += out[i];
  }
  out[nucleusAt] = Math.max(1, totalFrames - used);
  return out;
}
//// /把一拍音符的总帧数分给各 mora ////

//// 按拼音韵腹给一个音节分帧:韵腹延音、介音起音韵尾短 [@x380kkm 2026-06-20] ////
function allocateMoraFrames(parsed, moras, totalFrames) {
  return allocateWithNucleus(nucleusIndex(parsed, moras), moras, totalFrames);
}
//// /按拼音韵腹给一个音节分帧 ////

//// 取一组 mora 里最响的一拍下标:无拼音信息时按响度当韵腹 [@x380kkm 2026-06-20] ////
function mostSonorousIndex(moras) {
  let best = 0;
  let bestScore = -1;
  moras.forEach((m, i) => {
    const score = SONORITY[moraVowelLetter(m)] || 0;
    if (score >= bestScore) { bestScore = score; best = i; }
  });
  return best;
}
//// /取一组 mora 里最响的一拍下标 ////

//// 把中文歌词转成逐音节的拼音解析与片假名,跳过标点与韵律记号 [@x380kkm 2026-06-20] ////
// 歌唱时值由旋律决定,拼音转假名关掉补长音(elongate:false);拼不出的音节也保留以对齐旋律,记 ok:false 供上层察觉。
function lyricsToSyllables(lyrics) {
  const tokens = textToPinyinTokens(lyrics);
  const syllables = [];
  for (const tok of tokens) {
    if (!/^[a-zü]+[0-5]$/i.test(tok)) continue;
    const parsed = parsePinyin(tok);
    // 歌唱开 hGlideOnset:h+u 介音字用 ホ 起音而非 フ 行,避免长音上花听成发。
    const { kana, moras, ok } = syllableToKana(parsed, { elongate: false, hGlideOnset: true });
    syllables.push({ pinyin: tok, parsed, kana, moras, ok });
  }
  return syllables;
}
//// /把中文歌词转成逐音节的拼音解析与片假名 ////

//// 把一个音节摊到它占用的若干音符上,出逐 mora 的歌唱音符 [@x380kkm 2026-06-20] ////
// pitches 为该字占用的音符 [{ key, frames }];mora 数不多于音符数时逐音符放一个 mora、余下音符延续韵腹元音(花腔,时值由旋律给定),
// 多于音符数时把 mora 顺序分到各音符、音符内再按 mora 角色权重切分时值。
function layoutSyllable(parsed, moras, pitches) {
  if (moras.length === 0) {
    return pitches.map((p) => ({ key: p.key, frame_length: p.frames, lyric: 'ラ' }));
  }
  const out = [];
  const noteCount = pitches.length;
  if (moras.length <= noteCount) {
    for (let i = 0; i < noteCount; i++) {
      const lyric = i < moras.length ? moras[i] : vowelOf(moras[moras.length - 1]);
      out.push({ key: pitches[i].key, frame_length: pitches[i].frames, lyric });
    }
    return out;
  }
  // mora 多于音符:一字一音(单音符)时按拼音韵腹分帧;一字落多音符的罕见情形按序把 mora 分到各音符,音符内按响度当韵腹分帧
  if (noteCount === 1) {
    const frames = allocateMoraFrames(parsed, moras, pitches[0].frames);
    return moras.map((mora, i) => ({ key: pitches[0].key, frame_length: frames[i], lyric: mora }));
  }
  let mi = 0;
  for (let i = 0; i < noteCount; i++) {
    const count = Math.floor(moras.length / noteCount) + (i < moras.length % noteCount ? 1 : 0);
    const chunk = moras.slice(mi, mi + count);
    const frames = allocateWithNucleus(mostSonorousIndex(chunk), chunk, pitches[i].frames);
    chunk.forEach((mora, j) => out.push({ key: pitches[i].key, frame_length: frames[j], lyric: mora }));
    mi += count;
  }
  return out;
}
//// /把一个音节摊到它占用的若干音符上 ////

//// 把旋律一个发声条目归一成音符表 [{ key, frames }] [@x380kkm 2026-06-20] ////
// 单音符 { note 或 key, beats };花腔 { notes: [[音名或MIDI, 拍数], ...] }。
function entryToPitches(entry, bpm) {
  const pairs = entry.notes || [[entry.note != null ? entry.note : entry.key, entry.beats]];
  return pairs.map(([name, beats]) => ({ key: noteNameToMidi(name), frames: beatsToFrames(beats, bpm) }));
}
//// /把旋律一个发声条目归一成音符表 ////

//// 把中文歌词与旋律拼成 VOICEVOX Score [@x380kkm 2026-06-20] ////
// melody 为条目数组:发声音符 { note:音名 或 key:MIDI, beats:拍数 }、花腔 { notes:[[音名,拍数],...] }、休止 { rest:拍数 };
// 发声条目按序对应一个歌词音节。曲谱以休止开头(VOICEVOX 要求 Score 不以发声音符起头)。
function buildScore(lyrics, melody, options = {}) {
  const bpm = options.bpm || 70;
  const leadRestBeats = options.leadRestBeats != null ? options.leadRestBeats : 0.25;
  const tailRestBeats = options.tailRestBeats != null ? options.tailRestBeats : 0.25;
  const syllables = lyricsToSyllables(lyrics);
  const sungCount = melody.filter((e) => e.rest == null).length;
  if (sungCount !== syllables.length) {
    throw new Error(`旋律发声条目数 ${sungCount} 与歌词音节数 ${syllables.length} 不等`);
  }

  const notes = [{ key: null, frame_length: beatsToFrames(leadRestBeats, bpm), lyric: '' }];
  let s = 0;
  for (const entry of melody) {
    if (entry.rest != null) {
      notes.push({ key: null, frame_length: beatsToFrames(entry.rest, bpm), lyric: '' });
      continue;
    }
    const syllable = syllables[s];
    s += 1;
    const pitches = entryToPitches(entry, bpm);
    const moras = splitMoras(syllable.kana);
    for (const note of layoutSyllable(syllable.parsed, moras, pitches)) notes.push(note);
  }
  notes.push({ key: null, frame_length: beatsToFrames(tailRestBeats, bpm), lyric: '' });
  return { notes };
}
//// /把中文歌词与旋律拼成 VOICEVOX Score ////

//// 把旋律拼成哼唱 Score:每个音符唱同一个中性 mora,不要歌词 [@x380kkm 2026-06-20] ////
// 哼唱是歌唱路径的轻量分支:绕开拼音与咬字,每个音符(花腔逐音)放同一个 mora(默认 ン 闭口鼻音,亦可 ラ 等)。
function hummingScore(melody, options = {}) {
  const bpm = options.bpm || 70;
  const mora = options.mora || 'ン';
  const leadRestBeats = options.leadRestBeats != null ? options.leadRestBeats : 0.25;
  const tailRestBeats = options.tailRestBeats != null ? options.tailRestBeats : 0.25;
  const notes = [{ key: null, frame_length: beatsToFrames(leadRestBeats, bpm), lyric: '' }];
  for (const entry of melody) {
    if (entry.rest != null) {
      notes.push({ key: null, frame_length: beatsToFrames(entry.rest, bpm), lyric: '' });
      continue;
    }
    for (const p of entryToPitches(entry, bpm)) {
      notes.push({ key: p.key, frame_length: p.frames, lyric: mora });
    }
  }
  notes.push({ key: null, frame_length: beatsToFrames(tailRestBeats, bpm), lyric: '' });
  return { notes };
}
//// /把旋律拼成哼唱 Score ////

module.exports = {
  buildScore, hummingScore, noteNameToMidi, beatsToFrames, splitMoras, vowelOf, moraVowelLetter,
  nucleusVowelOfFinal, nucleusIndex, allocateWithNucleus, allocateMoraFrames, mostSonorousIndex,
  lyricsToSyllables, layoutSyllable, FRAMES_PER_SECOND,
};
