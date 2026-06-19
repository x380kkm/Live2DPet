// audience: internal
// # tone-pitch
// 声调与音高层:把普通话四声目标调值铺到 mora 的 pitch 上(applyMandarinTones,含三声变调与 downstep),给二三声画多拍调型(drawToneContours),
// 再叠整句下倾、句调、焦点、句首抬升,并对声调起伏做整体收窄(applyToneRangeScale)与上下两端软压(softCapToneRange)。
// 不变量:纯逻辑无副作用;只改 mora 的 pitch 与画调型时的 mora 切分;音高一律按 query 自身均值相对调整,适配不同声线。

//// 据声调与 mora 数算一个音节各 mora 的普通话四声目标音高(相对基准的五度调值) [@x380kkm 2026-06-15] ////
// 一声 55 高平、二声 35 升、三声 21 低、四声 51 降、轻声中略低。单拍取关键调值,走势靠相邻音节体现。
// 连读协同:非句末四声只半降到中位、非句末三声读半三声(低平不下潜),免得连续四声成锯齿、中段三声又低又弱。
// 句末治虚:句末三声止于 FINAL3(不潜到最低)、句末四声落到 FINAL4、句末单拍三声略抬、四声略离顶,
// 让句尾的字站得住、不发虚,且四声不反转。spread 缩放整体落差(<1 更平缓),默认 1。
function mandarinTone(tone, moras, base, phraseFinal = true, spread = 1, riseScale = 1, lowDepth = 0.36, prevTone = null, nextTone = null, lift = {}) {
  // 四声压低(协同发音、偏弱):前接三/四声压低起音(顺向同化),后接四/一声压缩降幅(逆向异化);二声升高在 drawToneContours 里做(它重画二声)。
  const t4DropStart = lift.t4DropStart || 0;
  const t4Compress = lift.t4Compress || 0;
  const HI = base + 0.40 * spread;
  const MID = base;
  // 三声是压到底的低调:LOW 的下压深度由 lowDepth 控制(越大压得越深),二声也从这个低位起步抬升,故 LOW 深、三声才像三声、二声起伏才对。
  const LOW = base - lowDepth * spread;
  const FINAL3 = base - (lowDepth + 0.10) * spread;
  const FINAL4 = base - 0.34 * spread;
  // 上扬封顶:二声的升、三声的回升只升到 MID 与 HI 之间的 RISE(riseScale<1 即不完全的回升)。
  // 连读里二声升到顶、三声回升不及就接下个字,听着诡异;升一个不完全的量更自然。riseScale=1 即升满到 HI。
  const RISE = MID + riseScale * (HI - MID);
  // 轻声的高低随前一个字的调尾定。默认表按声学实测排序:前二声后略高、前一声与前三声居中、前四声最低。
  // 经 A/B 试听确认这版比旧的五度听感约定表(前三声后读高)更自然。系数乘 spread、相对基准偏移,可经 lift.neutralAfter 覆盖供配置。无前字信息时落中低位。
  const naCoef = lift.neutralAfter || { 1: -0.10, 2: 0.08, 3: 0.00, 4: -0.30 };
  const NEUTRAL_AFTER = { 1: base + naCoef[1] * spread, 2: base + naCoef[2] * spread, 3: base + naCoef[3] * spread, 4: base + naCoef[4] * spread };
  const NEUTRAL = (prevTone != null && NEUTRAL_AFTER[prevTone] != null) ? NEUTRAL_AFTER[prevTone] : base - 0.20 * spread;
  const clamp = (value) => Math.max(4.8, Math.min(6.6, value));
  const out = [];
  const ramp = (lo, hi) => { for (let i = 0; i < moras; i += 1) out.push(lo + (hi - lo) * (i / (moras - 1))); };
  if (moras === 1) {
    const single = { 1: HI, 2: RISE, 3: LOW, 4: HI, 5: NEUTRAL };
    // 句末单拍:三声略抬离最低;四声放中高位而非顶——句末单拍四声(如「物」)放顶会被引擎从低邻拍顶成上冲尖峰、
    // 冲到全句最高(实测 F0 反升、听感像二声),放中高位只是个收尾的小高点,不上冲。非句末单拍四声(气、去)仍放顶,保辨识。
    const singleFinal = { 1: HI, 2: RISE, 3: LOW + 0.10, 4: MID + 0.16, 5: NEUTRAL };
    const table = phraseFinal ? singleFinal : single;
    return [clamp(table[tone] !== undefined ? table[tone] : MID)];
  }
  if (tone === 1) {
    for (let i = 0; i < moras; i += 1) out.push(HI);
  } else if (tone === 2) {
    // 二声先低后抬:起点压到 LOW(前一个字常偏高,二声要先压下来一点),再升到 RISE(riseScale 控制升幅、不升满)。
    ramp(LOW, RISE);
  } else if (tone === 3) {
    // 三声先压后平,不回升:句末降到 FINAL3、不潜到最低;非句末低平住(回升会被听成上扬的二声「尼」)。
    if (phraseFinal) { ramp(LOW, FINAL3); } else { for (let i = 0; i < moras; i += 1) out.push(LOW); }
  } else if (tone === 4) {
    if (phraseFinal) {
      // 句末四声降到 FINAL4(比中位再低一点、保留落感但不潜),不受语境压低。
      ramp(HI, FINAL4);
    } else {
      // 半四声 + 语境压低:前接三/四声压低起音,后接四/一声压缩降幅,但始终保留略降(不变纯平)。
      const hiStart = (prevTone === 3 || prevTone === 4) ? HI - t4DropStart * spread : HI;
      let midEnd = (nextTone === 4 || nextTone === 1) ? MID + t4Compress * spread : MID;
      if (midEnd >= hiStart) midEnd = hiStart - 0.04 * spread;
      ramp(hiStart, midEnd);
    }
  } else {
    for (let i = 0; i < moras; i += 1) out.push(NEUTRAL);
  }
  return out.map(clamp);
}
//// /据声调与 mora 数算普通话四声目标音高 ////

//// 在自然时长的 query 上铺普通话四声音高:逐音节吞 mora 覆盖片假名,与引擎自然音高按 toneStrength 混合 [@x380kkm 2026-06-15] ////
// 按四声调值铺音高把声调做出来,但不完全替换——与引擎自身平滑的自然音高混合,既听得出四声、又保留自然过渡不突兀;基准取 query 自身均值。
// config:toneStrength 四声强度(1=完全按四声、最分明也最突兀;小=更自然、四声更淡)、spread 四声整体落差。
// spread 默认 0.7:多句识别率实测在 0.7 处有明显峰值(总 69%,卷舌句「学习中文」整句正确),
// 高于 0.8 后音高摆幅过大反把卷舌、擦音的辅音冲糊、识别率掉到 50% 以下、句尾还冲出尖峰(峰 F0 515→442Hz);故落差收到 0.7 兼顾识别率与不突兀。
function applyMandarinTones(query, plan, config = {}) {
  const toneStrength = config.toneStrength != null ? config.toneStrength : 1.0;
  const spread = config.spread != null ? config.spread : 0.7;
  // 上扬封顶比例:二声从低位抬起时只抬到 MID 与 HI 之间的此比例处(<1 即不完全地抬,免得连读里抬过头显诡异)。
  // 默认 0.5:实听二声「学」从低位抬到半程最自然,抬满到顶反而冲、像在喊。
  const riseScale = config.riseScale != null ? config.riseScale : 0.5;
  const lowDepth = config.lowDepth != null ? config.lowDepth : 0.36;
  // 二声升高 / 四声压低的协同发音偏移(默认弱):顺向(看前字)默认开,逆向(看后字)默认关(0,争议大),都可调。
  const lift = {
    t2LiftStart: config.t2LiftStart != null ? config.t2LiftStart : 0.18,
    t2LiftPeak: config.t2LiftPeak != null ? config.t2LiftPeak : 0,
    t4DropStart: config.t4DropStart != null ? config.t4DropStart : 0.14,
    t4Compress: config.t4Compress != null ? config.t4Compress : 0,
    neutralAfter: config.neutralAfter,
  };
  // downstep:由低调(三声)触发的句内局部下压,opt-in,默认关(默认走 applyDeclination 的线性下倾)。
  // 经核验的研究认定这才是普通话句内下行的主因:一个低调把其后的高调拍整体压低一档(首个高调拍压满 step、其后按 recovery 指数回升),
  // 低调自身不被压、作为新的触发点,边界不清零。step 默认 0.144(约 2.5 个半音),recovery 默认 0.535(即 exp(-1/1.6))。
  const downstep = config.downstep || null;
  // step 默认 0.24(约 4 个半音):经主观试听确认这一加大档比 0.144 更听得出三声后高调被压一级再回升。
  const dsStep = (downstep && downstep.step != null) ? downstep.step : 0.24;
  const dsRecovery = (downstep && downstep.recovery != null) ? downstep.recovery : 0.535;
  // 前瞻抬升(anticipatory raising):三声(低调)之前的高调(一/二/四声)峰值略抬,是 downstep 的逆向异化一半(另一半是 downstep 压后字)。
  // 默认 0.04 对数 Hz(约 0.7 个半音),量小;只在句内(有后邻)、后邻是三声时对当前高调音节加。
  const antRaise = config.antRaise != null ? config.antRaise : 0.04;
  // 句末高调对 downstep 的缓解比例:downstep 把低调之后的高调压低一档,但到句末边界这一档与句末下降叠加,
  // 会把收尾的高平、高起调压垮(远方的方:既被前字「远」的 downstep 压满,又叠句末下降,听着掉得过狠)。
  // 句末音节只保留此比例的 downstep,默认 0.5(留半档),边界处不让 downstep 全压在收尾字上。
  const finalDownstepRelief = config.finalDownstepRelief != null ? config.finalDownstepRelief : 0.5;
  const moras = [];
  for (const phrase of (query.accent_phrases || [])) {
    for (const mora of (phrase.moras || [])) {
      moras.push(mora);
    }
  }
  const voiced = moras.filter((mora) => mora.pitch > 0);
  const base = voiced.length ? voiced.reduce((sum, mora) => sum + mora.pitch, 0) / voiced.length : 5.75;

  let index = 0;
  // 前一个字的(变调后)声调,供轻声按前字定高低;停顿组开头处重置不跨标点。
  let prevTone = null;
  // downstep 寄存器(对数 Hz,≤0):每遇三声压满到 -dsStep,其后每个高调拍按 dsRecovery 回升,边界不重置。
  let downReg = 0;
  for (let s = 0; s < plan.length; s += 1) {
    const syllable = plan[s];
    if (syllable.groupStart) {
      prevTone = null;
    }
    const target = (syllable.kana || '').length;
    const group = [];
    let covered = 0;
    while (index < moras.length && covered < target) {
      const mora = moras[index];
      index += 1;
      covered += (mora.text || '').length || 1;
      group.push(mora);
    }
    // 句末音节:全句最后一个,或下一个音节是新停顿组的开头。非句末走半四声、半三声的连读协同。
    const next = plan[s + 1];
    const phraseFinal = !next || Boolean(next.groupStart);
    // 后邻声调供四声压低判定;句末/跨停顿组时无连读后邻,置 null。
    const nextTone = phraseFinal ? null : next.tone;
    const contour = mandarinTone(syllable.tone, group.length, base, phraseFinal, spread, riseScale, lowDepth, prevTone, nextTone, lift);
    // downstep 偏移:三声把寄存器压满、自身不被压;非三声拍取当前寄存器值下移、再让寄存器向基线回升一档。
    let dsOffset = 0;
    if (downstep) {
      if (syllable.tone === 3) {
        downReg = -dsStep;
      } else {
        dsOffset = downReg;
        downReg *= dsRecovery;
      }
    }
    // 句末(标 sentenceEnd 的句末音节,或整段最后一个音节)的高调只承受部分 downstep,免得与句末下降叠成塌底。
    if (downstep && dsOffset < 0 && (syllable.sentenceEnd || s === plan.length - 1)) {
      dsOffset *= finalDownstepRelief;
    }
    // 前瞻抬升:后邻是三声、当前是高调(一/二/四声)时,把当前音节略抬;三声本身不抬(无真高点)。
    const antOffset = (antRaise > 0 && nextTone === 3 && (syllable.tone === 1 || syllable.tone === 2 || syllable.tone === 4)) ? antRaise : 0;
    for (let i = 0; i < group.length; i += 1) {
      // 给每个 mora 打上所属音节下标:画调型会重排、复制 mora,标签随之带过去,供焦点这步在重排后仍按音节定位。
      group[i].syl = s;
      if (group[i].pitch > 0 && contour[i] !== undefined) {
        // 与引擎自然音高混合:四声做出来,但保留自然的平滑过渡,不那么突兀;downstep 与前瞻抬升偏移叠在声调目标上。
        const blended = group[i].pitch * (1 - toneStrength) + (contour[i] + dsOffset + antOffset) * toneStrength;
        group[i].pitch = Math.max(4.8, Math.min(6.6, blended));
      }
    }
    prevTone = syllable.tone;
  }
  return query;
}
//// /在自然时长的 query 上铺普通话四声音高 ////

//// 把韵尾(鼻韵尾 ン 或 er 的卷舌 ル)从音节 mora 组里摘出来:变调只画在元音上、韵尾不参与,韵尾另接住调型的结尾音高 [@x380kkm 2026-06-17] ////
// 二声的升、三声的曲折该在元音上完成;若让韵尾也参与 contourBeats 重排,升的高点会落到韵尾上、元音反而低(羊被压住);
// 且 contourBeats 会把 ル 的辅音剥成裸元音、整字几乎不发声(而、儿二声听着没声)。故末拍是 ン 或 er 的 ル 时摘出,元音单独画调,韵尾收尾。
function splitToneCoda(group, syllable) {
  // 末拍可能是词边界切分的促音 ッ(cl),它跟在韵尾之后;先单独留作尾,韵尾从它之前找——否则韵尾 ン 没被认出、被当元音并入,contourBeats 重画时丢掉鼻尾(兰 ラエンッ→ラ e e、鼻音没了)。
  const sokuon = (group.length >= 2 && group[group.length - 1] && group[group.length - 1].vowel === 'cl') ? group[group.length - 1] : null;
  const codaIdx = sokuon ? group.length - 2 : group.length - 1;
  const codaM = group[codaIdx];
  const isCoda = codaIdx >= 1 && codaM && (codaM.text === 'ン' || (syllable && syllable.erFinal && codaM.text === 'ル'));
  if (isCoda) {
    return { vowels: group.slice(0, codaIdx), coda: codaM, sokuon };
  }
  return { vowels: sokuon ? group.slice(0, -1) : group, coda: null, sokuon };
}
//// /把韵尾从音节 mora 组里摘出来 ////

//// 把一个音节的 mora 组重切成按 pitches 画出的多拍:前几拍用原 mora 元音(单拍音节复制凑够)、末拍复制最后元音作尾,元音总长按 len 拉伸 [@x380kkm 2026-06-15] ////
// 复韵母(好 ハオ=ha-o)各拍沿用原元音、不被抹成单元音;辅音只留在第一拍。供 drawToneContours 画升调、曲折。
function contourBeats(group, pitches, len) {
  const consonant = group.reduce((sum, m) => sum + (m.consonant_length || 0), 0);
  const vowel = group.reduce((sum, m) => sum + (m.vowel_length || 0), 0) * len;
  const bodyCount = pitches.length - 1;
  const beats = [];
  for (let i = 0; i < bodyCount; i += 1) {
    beats.push({ ...group[Math.min(i, group.length - 1)] });
  }
  beats.push({ ...beats[beats.length - 1] });
  const seg = vowel / beats.length;
  // 零声母音节(一 イ、我 ウォ)合计辅音长为 0:辅音须为 null 且辅音长也为 null,
  // 否则出现 consonant=null 配 consonant_length=0 的不一致,引擎拒绝整份 query。
  const head = group[0].consonant || null;
  for (let i = 0; i < beats.length; i += 1) {
    beats[i].vowel_length = seg;
    beats[i].consonant = i === 0 ? head : null;
    beats[i].consonant_length = (i === 0 && head) ? consonant : null;
    beats[i].pitch = pitches[i];
    if (i > 0) beats[i].text = '';
  }
  return beats;
}
//// /把一个音节的 mora 组重切成按 pitches 画出的多拍 ////

//// 给一声拉长稳住高平、给二声、三声画出多拍调型:二声拉长画"先低后抬"的升,三声拉长画 214 曲折(降到底再不完全回升),短语末三声再加长 [@x380kkm 2026-06-15] ////
// 单拍音节一拍画不出升、画不出曲折,听着像高平或没调;这里把二声、三声的音节拉长重切成多拍,按调型铺音高,保留原元音。
// 一声按呼吸组内"轻重轻重"交替处理:重位拉长稳住高平,轻位略拉长并压低音高免得抢重音。句中三声(半三声)拉长并压平到低位、撑住低压,免得太短被听成二声。四声、轻声不动。须在 applyMandarinTones、时长归一、句末送气之后调用——它重排 mora、改时长,是管线最后一步。
function drawToneContours(query, plan, config = {}) {
  const t1 = Object.assign({ lenStrong: 1.25, lenWeak: 1.05, weakDrop: 0.08 }, config.t1 || {});
  // t2.liftStart:二声前接一/二声时把起点抬高(趋平近一声,顺向同化);t2.liftPeak:后接二/三声时把峰值再抬一点(逆向异化,默认 0)。
  const t2 = Object.assign({ len: 1.2, low: -0.30, rise: 0.16, liftStart: 0.18, liftPeak: 0 }, config.t2 || {});
  // 三声延长已撤回:lenFinal、lenLow 默认 1.0(不额外拉长,只画 214 曲折/半三声的音高,不再把元音乘长)。语速放慢后不再靠拉三声承调,免得句末三声(也、矣)拖太长。需要恢复可传 config.t3.lenFinal/lenLow。
  const t3 = Object.assign({ lenFinal: 1.0, mid: -0.20, bottom: -0.68, top: 0.05, lenLow: 1.0, lowDepth: -0.55 }, config.t3 || {});
  const all = [];
  for (const phrase of (query.accent_phrases || [])) {
    for (const mora of (phrase.moras || [])) {
      if (mora.pitch > 0) all.push(mora.pitch);
    }
  }
  if (!all.length) {
    return query;
  }
  const base = all.reduce((sum, p) => sum + p, 0) / all.length;
  let index = 0;
  let covered = 0;
  let group = [];
  let posInGroup = -1;
  for (const phrase of (query.accent_phrases || [])) {
    const out = [];
    for (const mora of phrase.moras) {
      group.push(mora);
      covered += (mora.text || '').length || 1;
      if (index < plan.length && covered >= (plan[index].kana || '').length) {
        const tone = plan[index].tone;
        const phraseFinal = (index === plan.length - 1) || (plan[index + 1] && plan[index + 1].groupStart);
        // 前邻、后邻(变调后)声调,供二声升高判定:组首处不跨停顿组取前邻,句末不取后邻。
        const prevTone = plan[index].groupStart ? null : (plan[index - 1] && plan[index - 1].tone);
        const nextTone = phraseFinal ? null : (plan[index + 1] && plan[index + 1].tone);
        // 呼吸组内按"轻重轻重"交替:组首音节为轻(偶数位),其后逢奇数位为重。轻声跳过(本就轻短)。
        posInGroup = plan[index].groupStart ? 0 : posInGroup + 1;
        const strong = (posInGroup % 2) === 1;
        if (tone === 1) {
          // 一声是高平。重位拉长稳住高平,轻位只略拉长且把音高压低一点,免得单拍高音变成全句最突出的重音(吃听成赤是太短,过长又会抢重音)。
          const factor = strong ? t1.lenStrong : t1.lenWeak;
          for (const g of group) {
            if (g.vowel_length > 0) g.vowel_length *= factor;
            if (!strong && g.pitch > 0) g.pitch -= t1.weakDrop;
            out.push(g);
          }
        } else if (tone === 2) {
          // 二声升高:前接一/二声时抬高起点(趋平近一声);后接二/三声时再抬一点峰值。否则维持原"先低后抬"。
          const lo = (prevTone === 1 || prevTone === 2) ? t2.low + t2.liftStart : t2.low;
          const hi = t2.rise + ((nextTone === 2 || nextTone === 3) ? t2.liftPeak : 0);
          // 升只画在元音上,韵尾(鼻音 ン 或 er 的 ル)摘出、接住升到的高点(不参与变调,免得升堆到韵尾、元音被压低或 ル 被剥成裸元音哑掉)。
          const { vowels, coda, sokuon } = splitToneCoda(group, plan[index]);
          for (const beat of contourBeats(vowels, [base + lo, base + lo, base + hi], t2.len)) out.push(beat);
          if (coda) { coda.pitch = base + hi; out.push(coda); }
          if (sokuon) out.push(sokuon);
        } else if (tone === 3 && phraseFinal) {
          // 只有短语末/句末的三声画完整 214 曲折;句中三声保持半三声(低、不回升,留给 applyMandarinTones 铺的低平),否则回升会听成二声「尼」。
          // 曲折只画在元音上,韵尾(鼻音 ン 或 er 的 ル)摘出、接住回升到的高点。
          const { vowels, coda, sokuon } = splitToneCoda(group, plan[index]);
          for (const beat of contourBeats(vowels, [base + t3.mid, base + t3.bottom, base + t3.top], t3.lenFinal)) out.push(beat);
          if (coda) { coda.pitch = base + t3.top; out.push(coda); }
          if (sokuon) out.push(sokuon);
        } else if (tone === 3) {
          // 句中三声是半三声(低平):低压时间太短会被听成二声(古听成鼓)。这里拉长把低压撑住,并压平到低位、不上飘。
          for (const g of group) {
            if (g.vowel_length > 0) g.vowel_length *= t3.lenLow;
            if (g.pitch > 0) g.pitch = base + t3.lowDepth;
            out.push(g);
          }
        } else {
          for (const g of group) out.push(g);
        }
        index += 1;
        covered = 0;
        group = [];
      }
    }
    for (const g of group) out.push(g);
    group = [];
    phrase.moras = out;
  }
  return query;
}
//// /给一声拉长稳住高平、给二声、三声画出多拍调型 ////

//// 整句下倾:把全句有声拍的 pitch 按位置线性向下压一点,越往后压得越多,叠在四声之上 [@x380kkm 2026-06-16] ////
// 普通话(及多数语言)一句话从头到尾基频整体缓慢走低,叫下倾(declination)。原中文路径没有这一项,整句听起来偏平、缺收束感。
// 这里在画好四声之后,对扁平化的全句有声拍加一道线性下压:首拍不动,末拍压 drop,中间按位置比例插值。
// drop 随句长增长但有上限(declMax),短句压得少、长句压到上限就不再加深,免得长句末尾被拖到过低。
// 下倾与句调分工:下倾管整句的缓慢走低,句调(applySentenceIntonation)只管句末一小段的升或降,两者叠加。问句的句末上扬由句调负责抵消末段的下压。
function applyDeclination(query, plan, config = {}) {
  const declSlope = config.declSlope != null ? config.declSlope : 0.03;
  const declMax = config.declMax != null ? config.declMax : 0.30;
  const voiced = [];
  for (const phrase of (query.accent_phrases || [])) {
    for (const mora of (phrase.moras || [])) {
      if (mora.pitch > 0) voiced.push(mora);
    }
  }
  if (voiced.length < 2) return query;
  const drop = Math.min(declMax, declSlope * (voiced.length - 1));
  // 下倾加速:积累的下压量随位置走加速曲线(前段降得慢、越往后越多),末拍降最多。pos^declExp,1.2 比线性稍快收束。
  const declExp = config.declExp != null ? config.declExp : 1.2;
  const clamp = (value) => Math.max(4.8, Math.min(6.6, value));
  for (let i = 0; i < voiced.length; i += 1) {
    const pos = i / (voiced.length - 1);
    voiced[i].pitch = clamp(voiced[i].pitch - drop * Math.pow(pos, declExp));
  }
  return query;
}
//// /整句下倾 ////

//// 按句类型铺句调:是非问句末区域上扬、陈述与特指问句末压低,只动整句最后一小段的 pitch、骑在四声之上 [@x380kkm 2026-06-16] ////
// 语调只改整体音高(这里是句末尾段的 pitch 偏移),不重画四声曲线——四声目标已铺好,句调叠在上面。
// 是非问:句末尾段(约 ynMoras 个有声拍)按位置幂次渐强抬高,越到末抬越多(全局抬升,非单点边界调)。
// 陈述与特指问:句末最后一小段(约 fallMoras 个有声拍)再压低一档(final lowering),与疑问句末上扬成对比。感叹句暂不特殊处理。
// 末段降幅由 fallExp 控制走向:0 是整段同压一档(平降);大于 0 时降幅随位置幂次加速,末字降最多(文献说陈述句最大降幅落在最后一个音节)。
// 默认 fallExp 取 1.5 走加速降、末段取最后 3 个有声拍、末字压满 0.12,经主观试听确认比平降收得更利落。
// 例外:句末是上升的二声时,末字本该往上扬,压低会把升调抹平(忙、来、谁念成平的);此时跳过末段压低,让二声的升保住。
// 多句:一次合成里有多句(真的吗?太好了!)时,按 plan[s].sentenceEnd 切句,每句各按自己的类型与末声调收尾,而不是整段只按最后一句。
// 须在 drawToneContours 之后调用(它重排 mora);用 mora.syl 标签把有声拍按句分组,故不依赖 mora 与音节一一对应。
function applySentenceIntonation(query, plan, config = {}) {
  const ynRise = config.ynRise != null ? config.ynRise : 0.22;
  const ynMoras = config.ynMoras != null ? config.ynMoras : 6;
  const finalFall = config.finalFall != null ? config.finalFall : 0.12;
  const fallMoras = config.fallMoras != null ? config.fallMoras : 3;
  // 句末降的走向:大于 1 加速(末字降最多),小于 1 减速。保持加速、末字降最多,1.5 偏过,降到 1.2 缓一点。
  const fallExp = config.fallExp != null ? config.fallExp : 1.2;
  const riseExp = config.riseExp != null ? config.riseExp : 1.2; // 句末是非问上扬同样加速、末字升最多
  const clamp = (value) => Math.max(4.8, Math.min(6.6, value));
  if (!plan || !plan.length) return query;
  // 逐音节算句序号(遇 sentenceEnd 后递增),并记每句的类型与末个非轻声声调。无 sentenceEnd 标记时整段为一句,行为同旧。
  const sentIdx = new Array(plan.length).fill(0);
  let cur = 0;
  for (let s = 0; s < plan.length; s += 1) { sentIdx[s] = cur; if (plan[s] && plan[s].sentenceEnd) cur += 1; }
  const sentCount = cur + 1;
  const sentType = new Array(sentCount).fill('statement');
  const sentFinalTone = new Array(sentCount).fill(null);
  for (let s = 0; s < plan.length; s += 1) {
    const i = sentIdx[s];
    if (plan[s].sentenceType) sentType[i] = plan[s].sentenceType;
    if (plan[s].tone !== 5) sentFinalTone[i] = plan[s].tone; // 升序覆盖,留该句最后一个非轻声声调
  }
  // 按句把有声拍分组(用 mora.syl 标签查句序号;无标签的归末句)。
  const groups = Array.from({ length: sentCount }, () => []);
  for (const phrase of (query.accent_phrases || [])) {
    for (const mora of (phrase.moras || [])) {
      if (mora.pitch <= 0) continue;
      const i = (mora.syl != null && sentIdx[mora.syl] != null) ? sentIdx[mora.syl] : sentCount - 1;
      groups[i].push(mora);
    }
  }
  const followRaise = config.ynParticleFollow != null ? config.ynParticleFollow : 0.05;
  // 对一句的句末区域铺句调:是非问按位置幂次渐强上扬;陈述与特指问加速压低,但末字是上升二声时跳过、保住升调。
  const applyRegion = (vm, type, finalTone) => {
    if (!vm.length) return;
    if (type === 'ynQuestion') {
      // 句末若是轻声语气词(吗/呢/吧,tone 5),上扬峰落在它前面的末实词上;语气词本应高平,只轻微跟随、不被强行抬到峰顶(否则吗听着怪)。
      let peakEnd = vm.length - 1;
      while (peakEnd > 0 && vm[peakEnd].syl != null && plan[vm[peakEnd].syl] && plan[vm[peakEnd].syl].tone === 5) peakEnd -= 1;
      const start = Math.max(0, peakEnd + 1 - ynMoras);
      const span = peakEnd - start;
      for (let i = start; i <= peakEnd; i += 1) {
        const pos = span > 0 ? (i - start) / span : 1;
        vm[i].pitch = clamp(vm[i].pitch + ynRise * Math.pow(pos, riseExp));
      }
      // 末尾轻声语气词只轻微跟随上扬,保住其高平、不上冲。
      for (let i = peakEnd + 1; i < vm.length; i += 1) vm[i].pitch = clamp(vm[i].pitch + followRaise);
    } else if ((type === 'statement' || type === 'whQuestion') && finalTone !== 2) {
      const start = Math.max(0, vm.length - fallMoras);
      const span = vm.length - start;
      for (let i = start; i < vm.length; i += 1) {
        const pos = span > 1 ? (i - start) / (span - 1) : 1;
        const drop = fallExp > 0 ? finalFall * Math.pow(pos, fallExp) : finalFall;
        vm[i].pitch = clamp(vm[i].pitch - drop);
      }
    }
  };
  for (let i = 0; i < sentCount; i += 1) applyRegion(groups[i], sentType[i], sentFinalTone[i]);
  return query;
}
//// /按句类型铺句调 ////

//// 均匀缩小声调起伏:每拍对全句均值的偏离一律乘 toneRangeScale,默认 0.65 [@x380kkm 2026-06-19] ////
// 把每拍对全句均值的偏离量整体乘一个系数,默认 0.65 先做一道整体收窄、让字调起伏小一点(中段也一起收),再由 softCapToneRange 接着压两端极端。
// 二者叠用:这一步定整体起伏的大盘,软膝盖只额外封住高低两端。须在所有铺音高的步之后、软膝盖之前调用;均值不变,整体音高高低不动。
function applyToneRangeScale(query, config = {}) {
  const scale = config.toneRangeScale != null ? config.toneRangeScale : 0.65;
  if (scale === 1) return query;
  const voiced = [];
  for (const phrase of (query.accent_phrases || [])) {
    for (const m of (phrase.moras || [])) { if (m.pitch > 0) voiced.push(m); }
  }
  if (voiced.length < 2) return query;
  const mean = voiced.reduce((sum, m) => sum + m.pitch, 0) / voiced.length;
  const clamp = (value) => Math.max(4.8, Math.min(6.6, value));
  for (const m of voiced) m.pitch = clamp(mean + (m.pitch - mean) * scale);
  return query;
}
//// /均匀缩小声调起伏 ////

//// 声调起伏软压上下极端:均值附近一段自然不动,越过膝盖后偏离量按指数渐近封顶,高侧膝盖更窄 [@x380kkm 2026-06-19] ////
// 绝对音高高低交给引擎 pitchScale,这一步只做相对锚定:算全句有声拍均值作中心,每拍对均值的偏离记 d = pitch - mean。
// |d| 不超过该侧膝盖的拍原样不动(中段自然字调不被压);越过的偏离按 knee + room*(1 - exp(-(|d|-knee)/room)) 重映射,故越往外越难走、最大偏离封到 knee+room。
// 高侧膝盖 kneeHi 比低侧 kneeLo 窄一半:更早压住「快断气」的高峰;低侧留宽,托住低位换气。须在所有铺音高的步之后调用;均值不变,整体音高高低不动。
function softCapToneRange(query, config = {}) {
  const kneeHi = config.toneKneeHi != null ? config.toneKneeHi : 0.06;
  const kneeLo = config.toneKneeLo != null ? config.toneKneeLo : 0.12;
  const room = config.toneRoom != null ? config.toneRoom : 0.1;
  if (config.softCapTone === false || room <= 0) return query;
  const voiced = [];
  for (const phrase of (query.accent_phrases || [])) {
    for (const m of (phrase.moras || [])) { if (m.pitch > 0) voiced.push(m); }
  }
  if (voiced.length < 2) return query;
  const mean = voiced.reduce((sum, m) => sum + m.pitch, 0) / voiced.length;
  for (const m of voiced) {
    const d = m.pitch - mean;
    const mag = Math.abs(d);
    const knee = d > 0 ? kneeHi : kneeLo; // 高侧膝盖窄、更早压高峰;低侧宽、保低位换气
    if (mag <= knee) continue;
    // 越过膝盖的偏离按指数渐近重映射,最大封到 knee+room,故越往外越难走。
    const capped = knee + room * (1 - Math.exp(-(mag - knee) / room));
    m.pitch = mean + Math.sign(d) * capped;
  }
  return query;
}
//// /声调起伏软压上下极端 ////

//// 焦点(句重音):焦点词调域扩张、焦点后压缩下移、焦点前不变,叠在已画的四声之上 [@x380kkm 2026-06-17] ////
// 普通话用焦点标记信息重点:焦点词调域扩张(高调更高、低调更低,故 T3 受焦是更低而非更高)、焦点后整段调域压窄且下移(post-focus compression)、焦点前几乎不变。
// 焦点音节由 plan[s].focus 标(上游标重点词时置真);无标记则中性焦点、此步不动。按 mora.syl 标签(applyMandarinTones 打、画调型后仍在)定位音节区位。
// 调域扩张/压缩都是相对全句基准 base 缩放偏离量:on 把 (pitch-base) 乘 onScale(高调离 base 更远、低调更低);post 下移 base 再乘 postScale 收窄;须在 drawToneContours 之后调用。
function applyFocus(query, plan, config = {}) {
  const onScale = config.focusOnScale != null ? config.focusOnScale : 1.4;
  const postScale = config.focusPostScale != null ? config.focusPostScale : 0.7;
  const postDrop = config.focusPostDrop != null ? config.focusPostDrop : 0.12;
  let focusStart = -1; let focusEnd = -1;
  for (let s = 0; s < plan.length; s += 1) {
    if (plan[s] && plan[s].focus) { if (focusStart < 0) focusStart = s; focusEnd = s; }
  }
  if (focusStart < 0) return query; // 无焦点标记,中性焦点不动
  // 焦点后压缩到下一个全停(语调短语边界)为止,跨不过标点。
  let postEnd = plan.length - 1;
  for (let s = focusEnd + 1; s < plan.length; s += 1) {
    if (plan[s - 1] && plan[s - 1].breakAfter === 'full') { postEnd = s - 1; break; }
  }
  const moras = [];
  for (const phrase of (query.accent_phrases || [])) for (const m of (phrase.moras || [])) if (m.pitch > 0) moras.push(m);
  if (!moras.length) return query;
  const base = moras.reduce((sum, m) => sum + m.pitch, 0) / moras.length;
  const clamp = (value) => Math.max(4.8, Math.min(6.6, value));
  for (const m of moras) {
    const s = m.syl;
    if (s == null) continue;
    if (s >= focusStart && s <= focusEnd) {
      m.pitch = clamp(base + (m.pitch - base) * onScale);
    } else if (s > focusEnd && s <= postEnd) {
      m.pitch = clamp((base - postDrop) + (m.pitch - base) * postScale);
    }
  }
  return query;
}
//// /焦点(句重音) ////

//// 句首话题抬升与边界后顶线部分重置:句首与每个停顿后的短语开头把音高抬一点、随后指数回落,叠在四声之上 [@x380kkm 2026-06-17] ////
// 普通话整句下行是多机制叠加的副产品:downstep(已做)把句内逐级压低,而每到停顿处说话人会把顶线抬回来一点(部分重置),句首/话题处抬得更多。
// 缺这一步时,长句经 downstep 一路压到底、过停顿也不回抬,听着越说越闷。这里按短语开头加一个随拍指数衰减的正偏移:句首最大、全停后次之、半停后最小。
// 在合成出的 accent_phrases 上做(每个 phrase 是一个连读组,其 pause_mora 长度区分全停 fullPause 与半停 minorPause);叠在画好的四声之上,clamp 不越界。须在 drawToneContours 之后调用。
function applyBaselineContour(query, config = {}) {
  const topicBoost = config.topicBoost != null ? config.topicBoost : 0.05; // 句首抬升(对数 Hz,约 0.9 个半音)
  const ipReset = config.ipReset != null ? config.ipReset : 0.18;          // 全停后顶线重置(约 3 个半音)
  const pphReset = config.pphReset != null ? config.pphReset : 0.08;       // 半停后顶线重置(约 1.4 个半音)
  const tau = config.resetTau != null ? config.resetTau : 2;               // 衰减时间常数(以有声拍计)
  const fullThresh = config.fullPauseThresh != null ? config.fullPauseThresh : 0.07; // 区分全停与半停的停顿时长门槛
  const clamp = (value) => Math.max(4.8, Math.min(6.6, value));
  const phrases = query.accent_phrases || [];
  let prevPause = undefined; // undefined 表示句首(无前驱短语)
  for (let pi = 0; pi < phrases.length; pi += 1) {
    const voiced = (phrases[pi].moras || []).filter((m) => m.pitch > 0);
    let boost = 0;
    if (prevPause === undefined) boost = topicBoost;       // 句首
    else if (prevPause === null) boost = 0;                // 与前一短语无停顿衔接,不重置
    else boost = prevPause >= fullThresh ? ipReset : pphReset;
    if (boost > 0) {
      for (let k = 0; k < voiced.length; k += 1) {
        const add = boost * Math.exp(-k / tau);
        if (add < 0.005) break;
        voiced[k].pitch = clamp(voiced[k].pitch + add);
      }
    }
    const pm = phrases[pi].pause_mora;
    prevPause = (pm && pm.vowel_length != null) ? pm.vowel_length : null;
  }
  return query;
}
//// /句首话题抬升与边界后顶线部分重置 ////

module.exports = { mandarinTone, applyMandarinTones, drawToneContours, applyDeclination, applySentenceIntonation, applyToneRangeScale, softCapToneRange, applyFocus, applyBaselineContour };
