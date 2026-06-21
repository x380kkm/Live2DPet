# /// script
# requires-python = ">=3.12"
# dependencies = ["mido"]
# ///
# audience: internal
# arrange-midi(scratch):把 MMA 出的伴奏 MIDI 编排成有声场的乐队——加一条吉他对位副旋律轨、一层弦乐铺底,给各声部布像与音量配比,并对力度做有界人性化抖动。
# 吉他线来自 lead.json(对位副旋律,与人声相似不同、互相呼应),弦乐铺底来自 chords.json(每和弦跨度持续三和弦),均从第 0 拍起与伴奏同小节对齐。
# 运行: uv run --python 3.12 archive/arrange-midi.py <backing.mid> <lead.json> <chords.json> <out.mid> [吉他program,缺省27]
import json
import sys
import mido

# 按 GM 乐器族给声像(0 左 .. 64 中 .. 127 右)与音量:鼓贝斯居中坐底,和弦键吉他左右铺开,弦乐偏侧,主奏吉他略偏中。
def pan_vol_for(program, is_drum):
    if is_drum:
        return 64, 102          # 鼓:居中、稳
    fam = program // 8
    if fam == 4:                # 32-39 贝斯
        return 64, 104
    if fam in (0, 1):           # 0-15 钢琴/键盘
        return 86, 82           # 键盘偏右
    if fam == 3:                # 24-31 吉他(和弦伴奏)
        return 40, 84           # 伴奏吉他偏左
    if fam in (5, 6):           # 40-55 弦乐/合奏
        return 100, 74          # 弦乐铺右侧
    return 64, 82

LEAD_PAN, LEAD_VOL = 58, 110    # 主奏吉他:略偏中、最突出

def flat_melody(mel):
    ev = []  # (start_beat, dur_beat, pitch)
    cum = 0.0
    for e in mel:
        if e.get('rest') is not None:
            cum += e['rest']
        elif e.get('notes'):
            for k, b in e['notes']:
                ev.append((cum, b, int(k)))
                cum += b
        else:
            ev.append((cum, e['beats'], int(e['key'])))
            cum += e['beats']
    return ev

#### 三和弦各音放到主音上方中音区的绝对音高(夹到合法 MIDI 区间) ####
def triad_notes(tonic, pcs, octave=4):
    out = []
    for pc in sorted({((tonic + p) % 12) for p in pcs}):
        v = pc + 12 * (round((tonic + 2 - pc) / 12) + octave)
        out.append(max(0, min(120, v)))
    return out

#### 弦乐轨:style='pad' 连续 legato 铺底(program 49,音持续到下一个和弦、首尾搭接无缝,加低八度根音增厚)、'pizz' 拨奏短点(program 45,每拍一拨) ####
def strings_track(chords, tpb, rng, style='pad', channel=11, prog_override=None):
    tonic = chords['tonicMidi']
    spans = chords['spans']
    tr = mido.MidiTrack()
    ch = channel
    prog = 45 if style == 'pizz' else (prog_override if prog_override is not None else 49)
    name = 'StringsPizz' if style == 'pizz' else 'StringsPad'
    pan = 96 if style == 'pad' else 34
    vol = 70 if style == 'pad' else 72
    tr.append(mido.MetaMessage('track_name', name=name, time=0))
    tr.append(mido.Message('control_change', channel=ch, control=10, value=pan, time=0))
    tr.append(mido.Message('control_change', channel=ch, control=7, value=vol, time=0))
    tr.append(mido.Message('program_change', channel=ch, program=prog, time=0))
    abs_ev = []
    for i, span in enumerate(spans):
        notes = triad_notes(tonic, span['pcs'], 4)
        if style == 'pizz':
            beats = int(round(span['beats']))
            for bi in range(max(1, beats)):
                on = round((span['startBeat'] + bi) * tpb)
                off = on + tpb // 3
                for v in notes:
                    abs_ev.append((on, mido.Message('note_on', channel=ch, note=v, velocity=70 + rng.randint(-8, 8), time=0)))
                    abs_ev.append((off, mido.Message('note_off', channel=ch, note=v, velocity=0, time=0)))
        else:
            # 连续铺底:本和弦音持续到下一个和弦起点(末跨度到曲尾),搭接处微叠 legato,无缝不断;补低八度根音增厚。
            on = round(span['startBeat'] * tpb)
            nxt = round(spans[i + 1]['startBeat'] * tpb) if i + 1 < len(spans) else round((span['startBeat'] + span['beats']) * tpb)
            off = nxt + tpb // 16  # 微叠到下一和弦,避免接缝处空隙
            body = [notes[0] - 12] if notes else []  # 低八度根音垫底
            for v in notes + body:
                abs_ev.append((on, mido.Message('note_on', channel=ch, note=max(0, v), velocity=52 + rng.randint(-4, 4), time=0)))
                abs_ev.append((off, mido.Message('note_off', channel=ch, note=max(0, v), velocity=0, time=0)))
    abs_ev.sort(key=lambda x: x[0])
    last = 0
    for t, m in abs_ev:
        m.time = max(0, t - last)
        last = t
        tr.append(m)
    return tr

#### 合成琶音轨(锯齿 81):整曲连续十六分音符循环和弦音,做电子律动的招牌琶音,取代柔和的持续铺底 ####
def synth_arp_track(chords, tpb, rng):
    tonic = chords['tonicMidi']
    tr = mido.MidiTrack()
    ch = 11
    tr.append(mido.MetaMessage('track_name', name='SynthArp', time=0))
    tr.append(mido.Message('control_change', channel=ch, control=10, value=70, time=0))
    tr.append(mido.Message('control_change', channel=ch, control=7, value=78, time=0))
    tr.append(mido.Message('program_change', channel=ch, program=81, time=0))  # 81=Saw Lead
    step = max(1, tpb // 4)  # 十六分音符
    abs_ev = []
    for span in chords['spans']:
        notes = triad_notes(tonic, span['pcs'], 5)  # 高音区琶音
        seq = notes + notes[::-1][1:]
        n = int(round(span['beats'] * tpb / step))
        for i in range(n):
            v = seq[i % len(seq)]
            on = round(span['startBeat'] * tpb) + i * step
            off = on + step - 2
            abs_ev.append((on, mido.Message('note_on', channel=ch, note=v, velocity=72 + rng.randint(-6, 6), time=0)))
            abs_ev.append((off, mido.Message('note_off', channel=ch, note=v, velocity=0, time=0)))
    abs_ev.sort(key=lambda x: x[0])
    last = 0
    for t, m in abs_ev:
        m.time = max(0, t - last)
        last = t
        tr.append(m)
    return tr

#### 钢琴分解和弦轨(program 0):每半小节把三和弦音逐个八分音符上行铺开,做流动的分解伴奏 ####
def piano_arp_track(chords, tpb, rng):
    tonic = chords['tonicMidi']
    tr = mido.MidiTrack()
    ch = 12
    tr.append(mido.MetaMessage('track_name', name='PianoArp', time=0))
    tr.append(mido.Message('control_change', channel=ch, control=10, value=72, time=0))
    tr.append(mido.Message('control_change', channel=ch, control=7, value=70, time=0))
    tr.append(mido.Message('program_change', channel=ch, program=0, time=0))
    abs_ev = []
    for span in chords['spans']:
        notes = triad_notes(tonic, span['pcs'], 4)
        seq = notes + notes[::-1][1:]  # 上行再下行
        step = max(1, round(span['beats'] * tpb / max(1, len(seq))))
        for i in range(round(span['beats'] * tpb / step)):
            v = seq[i % len(seq)]
            on = round(span['startBeat'] * tpb) + i * step
            off = on + step - 2
            abs_ev.append((on, mido.Message('note_on', channel=ch, note=v, velocity=58 + rng.randint(-8, 8), time=0)))
            abs_ev.append((off, mido.Message('note_off', channel=ch, note=v, velocity=0, time=0)))
    abs_ev.sort(key=lambda x: x[0])
    last = 0
    for t, m in abs_ev:
        m.time = max(0, t - last)
        last = t
        tr.append(m)
    return tr

def main():
    backing_path, lead_path, chords_path, arrange_path, out_path = sys.argv[1:6]
    recipe = json.load(open(arrange_path, encoding='utf-8'))
    lead_prog = int(recipe.get('leadProgram', 27))
    lead_pan = int(recipe.get('leadPan', LEAD_PAN))
    strings_style = recipe.get('strings', 'pad')   # pad | pizz | none
    piano_arp = bool(recipe.get('pianoArp', False))
    pad_program = int(recipe.get('padProgram', 49))  # 铺底音色:常规弦乐合奏 49,硬核用更亮的合成弦 50
    drum_boost = bool(recipe.get('drumBoost', False))  # 硬核加重鼓
    mid = mido.MidiFile(backing_path)
    tpb = mid.ticks_per_beat
    rng = __import__('random').Random(20240620)
    bar_ticks = 4 * tpb

    used = set()
    for tr in mid.tracks:
        for m in tr:
            if m.type in ('note_on', 'note_off') and hasattr(m, 'channel'):
                used.add(m.channel)
            # 布像与音量:每个声部轨开头插 pan(CC10)与 volume(CC7)
        # 找该轨的主通道与是否鼓
        ch = next((m.channel for m in tr if m.type == 'program_change'), None)
        prog = next((m.program for m in tr if m.type == 'program_change'), 0)
        if ch is None:
            continue
        is_drum = (ch == 9)
        pan, vol = pan_vol_for(prog, is_drum)
        tr.insert(0, mido.Message('control_change', channel=ch, control=10, value=pan, time=0))
        tr.insert(0, mido.Message('control_change', channel=ch, control=7, value=vol, time=0))
        # 硬核电子:把 MMA 伴奏的原声音色重配成合成器——和弦/键/吉他/弦组改锯齿(81),贝斯改合成贝斯(38),让底色变电子。
        if drum_boost and not is_drum:
            fam = prog // 8
            newp = 38 if fam == 4 else (81 if fam in (0, 1, 2, 3, 5, 6, 11) else prog)
            for m in tr:
                if m.type == 'program_change':
                    m.program = newp
        # 力度人性化:给每个 note_on 加有界抖动,做出呼吸感;硬核模式给鼓整体抬力度
        for m in tr:
            if m.type == 'note_on' and m.velocity > 0:
                m.velocity = max(20, min(118, m.velocity + rng.randint(-10, 8)))
                if is_drum and drum_boost:
                    m.velocity = max(m.velocity, min(125, m.velocity + 16))
        # 硬核:在鼓轨补四分底鼓(每拍一记 35 号底鼓),做强劲推进
        if is_drum and drum_boost:
            evs = []
            t = 0
            for m in tr:
                t += m.time
                evs.append([t, m])
            end = max((t for t, _ in evs), default=0)
            for b0 in range(0, end + 1, tpb):
                evs.append([b0, mido.Message('note_on', channel=9, note=36, velocity=112, time=0)])
                evs.append([b0 + tpb // 6, mido.Message('note_off', channel=9, note=36, velocity=0, time=0)])
            evs.sort(key=lambda x: x[0])
            tr[:] = []
            last = 0
            for t, m in evs:
                m.time = max(0, t - last)
                last = t
                tr.append(m)

    # 选一个未占用的通道给主奏吉他(避开鼓 9)
    lead_ch = next((c for c in range(16) if c not in used and c != 9), 8)
    lead = mido.MidiTrack()
    lead.append(mido.MetaMessage('track_name', name='Lead', time=0))
    lead.append(mido.Message('control_change', channel=lead_ch, control=10, value=lead_pan, time=0))
    lead.append(mido.Message('control_change', channel=lead_ch, control=7, value=LEAD_VOL, time=0))
    lead.append(mido.Message('program_change', channel=lead_ch, program=lead_prog, time=0))
    # 把对位副旋律事件转成绝对 tick 的 note on/off,再排序、差分编码
    abs_ev = []
    for sb, db, pitch in flat_melody(json.load(open(lead_path, encoding='utf-8'))['melody']):
        on = round(sb * tpb)
        off = round((sb + db) * tpb) - 2  # 略留断点,避免连音糊在一起
        if off <= on:
            off = on + 1
        vel = max(70, min(115, 98 + rng.randint(-8, 8)))
        abs_ev.append((on, mido.Message('note_on', channel=lead_ch, note=pitch, velocity=vel, time=0)))
        abs_ev.append((off, mido.Message('note_off', channel=lead_ch, note=pitch, velocity=0, time=0)))
    abs_ev.sort(key=lambda x: x[0])
    last = 0
    for t, m in abs_ev:
        m.time = max(0, t - last)
        last = t
        lead.append(m)
    mid.tracks.append(lead)
    # 始终加一层连续 legato 弦乐铺底作和声床:既填满声场,又因连绵不断而盖住人声换气处的空隙,使乐句衔接不突兀。
    chords = json.load(open(chords_path, encoding='utf-8'))
    # 硬核电子用锯齿合成琶音(律动)取代柔和的持续弦乐铺底;常规仍用连续 legato 弦乐床。
    if drum_boost:
        mid.tracks.append(synth_arp_track(chords, tpb, rng))
    else:
        mid.tracks.append(strings_track(chords, tpb, rng, 'pad', channel=11, prog_override=pad_program))
    # 配方若选拨奏,再叠一层拨奏弦乐做点缀(独立通道);选钢琴分解则加流动的分解和弦。
    if strings_style == 'pizz':
        mid.tracks.append(strings_track(chords, tpb, rng, 'pizz', channel=13))
    if piano_arp:
        mid.tracks.append(piano_arp_track(chords, tpb, rng))
    mid.save(out_path)
    print(f"编排完成:主奏(program {lead_prog}) + 弦乐 {strings_style} + 钢琴分解 {piano_arp} + 声场布像/力度 -> {out_path}")

main()
