# /// script
# requires-python = ">=3.12"
# dependencies = ["mido"]
# ///
# audience: internal
# extra-layers
#
# mido 配器加层后处理:读入 arrange-midi.py 出的多轨伴奏 MIDI,按 arrange.json 与固定种子
# 随机源,从四类候选层里挑选并叠加,让配器更厚、声场更满,而靠分音区、声像、频段避免糊。
# 四类候选层:
#   1. 暖合成 pad(GM 89/90/91 之一):垫在弦乐之下、低中音区、声像居中、音量低,做底床;
#      连续不断,本和弦持续到下一和弦,不在句间留空。
#   2. 高音点缀(钟琴 9 / 颤音琴 11 / 八音盒 10):弱拍或句尾稀疏点几个和弦音,坐高音区、声像偏一侧。
#   3. 长音 stab(铜管 61/62 或弦乐合奏 48):在段落强拍点一记厚长音,声像与频段都让开主奏。
#   4. 轻打击点缀(沙锤 70 / 铃鼓 54):走 GM 鼓通道 9,补节奏颗粒。
#
# 各持续型层独占一个未占用通道(扫描已用通道避让,鼓固定 9),和弦音从 chords.json 的 spans 取:
# 绝对音高 = (tonicMidi + pc) 归到该层目标音区。所有随机走同一个固定种子,产物可复现。
#
# 运行前提:GeneralUser GS(GM SoundFont)+ FluidSynth 渲染,GM 鼓固定在 MIDI 通道 9。
# 全局不变量:不改任何已存在轨,只追加新轨;同 tick 内 note_off 排在 note_on 之前防瞬时叠音。
#
# 命令行:uv run --python 3.12 --with mido archive/extra-layers.py <in.mid> <chords.json> <arrange.json> <out.mid>

import sys
import json
import random

import mido


DRUM_CHANNEL = 9       # GM 鼓固定通道。
CC_VOLUME = 7          # CC7:通道静态音量。
CC_PAN = 10            # CC10:声像,0 左 / 64 中 / 127 右。

# 各候选层的 program 选项(从中按种子随机挑一个),与目标音区、声像、音量。
PAD_PROGRAMS = [89, 90, 91]            # 暖合成 pad(Warm / Polysynth / Space)。
SPARKLE_PROGRAMS = [9, 11, 10]         # 钟琴 / 颤音琴 / 八音盒。
STAB_PROGRAMS = [61, 62, 48]           # 铜管合奏 / 合成铜管 / 弦乐合奏。
SHAKER_KEY = 70                        # GM 打击:Maracas(沙锤)。
TAMBOURINE_KEY = 54                    # GM 打击:Tambourine(铃鼓)。


#### 绝对事件流:与 arrange-midi.py 同构,排序后差分编码回一条轨 ####

def to_track(header, abs_ev):
    """把 (abs_tick, msg) 列表按 tick 稳定排序后差分编码成一条轨。

    header 是轨首的设置消息(track_name、CC、program_change),原样置于所有发音之前;
    同 tick 内 note_off(含力度 0 的 note_on)排在发音之前,避免瞬时叠音被合成器吞掉。
    """
    def sort_key(item):
        tick, msg = item
        is_off = msg.type == "note_off" or (msg.type == "note_on" and msg.velocity == 0)
        return (tick, 0 if is_off else 1)

    tr = mido.MidiTrack()
    for msg in header:
        msg.time = 0
        tr.append(msg)
    last = 0
    for tick, msg in sorted(abs_ev, key=sort_key):
        msg.time = max(0, tick - last)
        tr.append(msg)
        last = tick
    return tr


#### 节拍与通道上下文 ####

def used_channels(mid):
    """扫描所有轨,收集已被发音占用的通道集合。"""
    used = set()
    for tr in mid.tracks:
        for m in tr:
            if m.type in ("note_on", "note_off") and hasattr(m, "channel"):
                used.add(m.channel)
    return used


def end_tick_of(mid):
    """整曲最大绝对 tick,作为持续型层的曲尾边界。"""
    return max((sum(m.time for m in tr) for tr in mid.tracks), default=0)


def pitch_in_register(tonic, pc, low, high):
    """把音级 pc(相对主音半音)落到 [low, high] 音区里的绝对音高。

    先取主音同八度的该音级,再整体八度平移到目标音区中心附近,最后夹到合法 MIDI。
    """
    note = (tonic + pc) % 12
    center = (low + high) // 2
    # 把 note 抬到不低于 low 的最近八度,再向中心收一格,落进音区。
    while note < low:
        note += 12
    while note > high:
        note -= 12
    if note < low:
        note += 12
    # 偏向中心:若整体能更贴近中心则平移一个八度。
    if abs(note + 12 - center) < abs(note - center) and note + 12 <= high:
        note += 12
    if abs(note - 12 - center) < abs(note - center) and note - 12 >= low:
        note -= 12
    return max(0, min(127, note))


#### 层一:暖合成 pad 底床(持续不断,垫在弦乐之下) ####

def warm_pad_layer(chords, tpb, end_tick, channel, rng):
    """暖合成 pad,本和弦持续到下一和弦(末跨度到曲尾),低中音区、居中、低音量。

    与弦乐 StringsPad 分音区(更低)且更弱,只做底床不抢前景。返回 (轨, 描述)。
    """
    tonic = chords["tonicMidi"]
    spans = chords["spans"]
    program = rng.choice(PAD_PROGRAMS)
    header = [
        mido.MetaMessage("track_name", name="WarmPad", time=0),
        mido.Message("control_change", channel=channel, control=CC_PAN, value=64, time=0),
        mido.Message("control_change", channel=channel, control=CC_VOLUME, value=46, time=0),
        mido.Message("program_change", channel=channel, program=program, time=0),
    ]

    abs_ev = []
    # pad 坐在弦乐之下:低中音区 G2..D4(43..62),只取根音与五音,留中高频给弦乐与点缀。
    low, high = 43, 62
    for i, span in enumerate(spans):
        on = round(span["startBeat"] * tpb)
        nxt = round(spans[i + 1]["startBeat"] * tpb) if i + 1 < len(spans) \
            else round((span["startBeat"] + span["beats"]) * tpb)
        nxt = min(nxt, end_tick) if end_tick else nxt
        off = nxt + tpb // 16  # 微叠到下一和弦,接缝处无空隙。
        pcs = span["pcs"]
        voices = [pcs[0], pcs[len(pcs) // 2]] if len(pcs) >= 2 else pcs  # 根音加一个中间音,音色不挤。
        for pc in voices:
            note = pitch_in_register(tonic, pc, low, high)
            vel = 40 + rng.randint(-4, 4)
            abs_ev.append((on, mido.Message("note_on", channel=channel, note=note, velocity=vel, time=0)))
            abs_ev.append((off, mido.Message("note_off", channel=channel, note=note, velocity=0, time=0)))

    return to_track(header, abs_ev), "WarmPad(program %d, ch %d, 持续底床)" % (program, channel)


#### 层二:高音点缀(弱拍或句尾稀疏点几个和弦音) ####

def sparkle_layer(chords, tpb, channel, rng):
    """钟琴族高音点缀:在弱拍按概率稀疏点单个和弦音,坐高音区、声像偏右。

    短音、低中力度,只补晶莹颗粒不成线。返回 (轨, 描述, 点数)。
    """
    tonic = chords["tonicMidi"]
    spans = chords["spans"]
    program = rng.choice(SPARKLE_PROGRAMS)
    header = [
        mido.MetaMessage("track_name", name="Sparkle", time=0),
        mido.Message("control_change", channel=channel, control=CC_PAN, value=96, time=0),
        mido.Message("control_change", channel=channel, control=CC_VOLUME, value=58, time=0),
        mido.Message("program_change", channel=channel, program=program, time=0),
    ]

    abs_ev = []
    hits = 0
    low, high = 84, 100  # C6..E7 高音区,与人声主奏频段错开。
    for i, span in enumerate(spans):
        beats = max(1, int(round(span["beats"])))
        is_phrase_end = (i % 4 == 3)  # 每四跨度的末跨度视作句尾,点得更密。
        for bi in range(beats):
            on_beat = span["startBeat"] + bi
            is_weak = (round(on_beat) % 2 == 1)  # 弱拍。
            if not (is_weak or (is_phrase_end and bi == beats - 1)):
                continue
            prob = 0.5 if is_phrase_end else 0.25
            if rng.random() >= prob:
                continue
            pc = rng.choice(span["pcs"])
            note = pitch_in_register(tonic, pc, low, high)
            on = round(on_beat * tpb) + rng.randint(0, tpb // 8)  # 轻微靠后,不踩正拍。
            off = on + tpb // 2                                   # 短促晶莹。
            vel = 62 + rng.randint(-8, 8)
            abs_ev.append((on, mido.Message("note_on", channel=channel, note=note, velocity=vel, time=0)))
            abs_ev.append((off, mido.Message("note_off", channel=channel, note=note, velocity=0, time=0)))
            hits += 1

    return to_track(header, abs_ev), "Sparkle(program %d, ch %d, %d 点)" % (program, channel, hits), hits


#### 层三:长音 stab(段落强拍点厚长音) ####

def stab_layer(chords, tpb, channel, rng):
    """铜管或弦乐合奏长音 stab:在段落强拍(每隔几个跨度的拍 0)点一记厚和弦长音。

    占整跨度时值,中音区、声像偏左,与弦乐铺底分侧。返回 (轨, 描述, 点数)。
    """
    tonic = chords["tonicMidi"]
    spans = chords["spans"]
    program = rng.choice(STAB_PROGRAMS)
    header = [
        mido.MetaMessage("track_name", name="Stab", time=0),
        mido.Message("control_change", channel=channel, control=CC_PAN, value=40, time=0),
        mido.Message("control_change", channel=channel, control=CC_VOLUME, value=66, time=0),
        mido.Message("program_change", channel=channel, program=program, time=0),
    ]

    abs_ev = []
    hits = 0
    low, high = 55, 74  # G3..D5 中音区。
    for i, span in enumerate(spans):
        if i % 4 != 0:  # 只在每四跨度的段首强拍点 stab,稀疏有力。
            continue
        on = round(span["startBeat"] * tpb)
        off = on + round(span["beats"] * tpb) - tpb // 8  # 占满跨度,留小断点。
        for pc in span["pcs"]:
            note = pitch_in_register(tonic, pc, low, high)
            vel = 78 + rng.randint(-6, 6)
            abs_ev.append((on, mido.Message("note_on", channel=channel, note=note, velocity=vel, time=0)))
            abs_ev.append((off, mido.Message("note_off", channel=channel, note=note, velocity=0, time=0)))
        hits += 1

    return to_track(header, abs_ev), "Stab(program %d, ch %d, %d 记)" % (program, channel, hits), hits


#### 层四:轻打击点缀(走鼓通道 9 补节奏颗粒) ####

def percussion_layer(chords, tpb, rng):
    """沙锤或铃鼓走 GM 鼓通道 9,在弱拍补轻打击颗粒。

    打击轨无 program(鼓通道按音符选音色),只布像不调音色。返回 (轨, 描述, 点数)。
    """
    spans = chords["spans"]
    key = rng.choice([SHAKER_KEY, TAMBOURINE_KEY])
    name = "Maracas" if key == SHAKER_KEY else "Tambourine"
    header = [
        mido.MetaMessage("track_name", name="Perc-" + name, time=0),
        mido.Message("control_change", channel=DRUM_CHANNEL, control=CC_PAN, value=72, time=0),
    ]

    abs_ev = []
    hits = 0
    eighth = tpb // 2
    total_beats = spans[-1]["startBeat"] + spans[-1]["beats"]
    n_eighth = int(round(total_beats * 2))
    for k in range(n_eighth):
        # 走八分网格,弱位(反拍)概率高,正拍偶尔轻点,补颗粒不抢鼓点。
        is_offbeat = (k % 2 == 1)
        prob = 0.7 if is_offbeat else 0.15
        if rng.random() >= prob:
            continue
        on = k * eighth
        off = on + max(1, eighth // 2)  # 短促。
        vel = (44 if is_offbeat else 36) + rng.randint(-6, 6)
        vel = max(1, min(127, vel))
        abs_ev.append((on, mido.Message("note_on", channel=DRUM_CHANNEL, note=key, velocity=vel, time=0)))
        abs_ev.append((off, mido.Message("note_off", channel=DRUM_CHANNEL, note=key, velocity=0, time=0)))
        hits += 1

    return to_track(header, abs_ev), "Perc-%s(ch %d, %d 击)" % (name, DRUM_CHANNEL, hits), hits


#### 主流程:按 arrange.json 与种子挑层组合 ####

def free_channel(used, taken):
    """从 0..15 里取一个既未被原曲占用、又未被本轮新层占用、且非鼓通道的通道。"""
    for c in range(16):
        if c == DRUM_CHANNEL or c in used or c in taken:
            continue
        return c
    return None


def select_layers(recipe, rng):
    """按 arrange.json 配方与种子决定加哪些层,做出每首不同的层次组合。

    持续型 pad 高概率(底床最有用);其余三类按配方倾向与掷骰各自决定开关,不必全加。
    """
    counter = recipe.get("counterMode", "")
    has_piano = bool(recipe.get("pianoArp", False))

    plan = {}
    plan["pad"] = rng.random() < 0.85               # 底床几乎总加,填满声场最有效。
    plan["sparkle"] = rng.random() < (0.7 if not has_piano else 0.5)  # 已有钢琴分解则少点高音线。
    plan["stab"] = rng.random() < (0.65 if counter == "sustained" else 0.45)
    plan["perc"] = rng.random() < 0.7               # 颗粒打击常加,补律动。
    # 至少加两层,避免极端情况几乎没加。
    if sum(plan.values()) < 2:
        plan["pad"] = True
        plan["perc"] = True
    return plan


def process(in_path, chords_path, arrange_path, out_path, seed=20240620):
    rng = random.Random(seed)
    mid = mido.MidiFile(in_path)
    tpb = mid.ticks_per_beat
    chords = json.load(open(chords_path, encoding="utf-8"))
    recipe = json.load(open(arrange_path, encoding="utf-8"))

    used = used_channels(mid)
    end_tick = end_tick_of(mid)
    plan = select_layers(recipe, rng)

    taken = set()
    added = []
    if plan["pad"]:
        ch = free_channel(used, taken)
        if ch is not None:
            taken.add(ch)
            tr, desc = warm_pad_layer(chords, tpb, end_tick, ch, rng)
            mid.tracks.append(tr)
            added.append(desc)
    if plan["sparkle"]:
        ch = free_channel(used, taken)
        if ch is not None:
            taken.add(ch)
            tr, desc, _ = sparkle_layer(chords, tpb, ch, rng)
            mid.tracks.append(tr)
            added.append(desc)
    if plan["stab"]:
        ch = free_channel(used, taken)
        if ch is not None:
            taken.add(ch)
            tr, desc, _ = stab_layer(chords, tpb, ch, rng)
            mid.tracks.append(tr)
            added.append(desc)
    if plan["perc"]:
        tr, desc, _ = percussion_layer(chords, tpb, rng)  # 走鼓通道 9,无需独占。
        mid.tracks.append(tr)
        added.append(desc)

    mid.save(out_path)
    return added


def main(argv):
    if len(argv) != 5:
        print("usage: extra-layers.py <in.mid> <chords.json> <arrange.json> <out.mid>", file=sys.stderr)
        return 2
    in_path, chords_path, arrange_path, out_path = argv[1:5]
    src = mido.MidiFile(in_path)
    added = process(in_path, chords_path, arrange_path, out_path)
    dst = mido.MidiFile(out_path)
    src_notes = sum(1 for tr in src.tracks for m in tr if m.type == "note_on" and m.velocity > 0)
    dst_notes = sum(1 for tr in dst.tracks for m in tr if m.type == "note_on" and m.velocity > 0)
    print("extra-layers done:", in_path, "->", out_path)
    print("  tracks: %d -> %d (+%d)" % (len(src.tracks), len(dst.tracks), len(dst.tracks) - len(src.tracks)))
    print("  note_on: %d -> %d (+%d)" % (src_notes, dst_notes, dst_notes - src_notes))
    print("  added layers:")
    for desc in added:
        print("    -", desc)
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv))
