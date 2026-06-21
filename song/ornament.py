# /// script
# requires-python = ">=3.12"
# dependencies = ["mido"]
# ///
# audience: internal
# ornament
#
# mido 装饰后处理:读入 MMA + arrange-midi.py 出的伴奏 MIDI,输出加装饰后的 MIDI。
# 本轮只做零依赖、最高性价比的力度类与人性化三件套加防叠音:
#   1. 鼓(通道 9):弱位补军鼓鬼音、backbeat 加重音、hi-hat 力度波动,只增益不破坏原鼓点。
#   2. 全局 humanize:每个 note_on 加微时值抖动与力度抖动,鼓 pocket 略偏后、其它略偏紧。
#   3. 钢琴/和弦类轨:把整块同时触发的和弦琶音化错开(低到高),顶音力度略高。
#   4. 防叠音:同轨同音高前音 note_off 不晚于后音 note_on。
#
# 弯音/CC 表现性装饰留待后续,GM CC 语义常量与 pitchwheel 换算集中在 GmExpression 工具区,
# 已为后续弯音类装饰预留 set_pitchbend_range / bend / ramp_cc 接口,本轮不调用。
#
# 运行前提:GeneralUser GS(GM SoundFont)+ FluidSynth 渲染,鼓固定在 MIDI 通道 9。
# 全局不变量:所有时间抖动与鬼音力度都走同一个固定种子的随机源,产物可复现。
#
# 命令行:uv run --python 3.12 --with mido archive/ornament.py <in.mid> <out.mid>

import sys
import random
from collections import defaultdict

import mido


#### GM CC 语义与 pitchwheel 换算工具区 ####

# GM SoundFont(SF2.01 默认调制器)下的标准 CC 编号,集中一处便于后续换音色库只改这里。
CC_MODULATION = 1      # CC1:在 GeneralUser GS 上控制颤音 LFO 音高深度(揉弦),不是力度层交叉淡化。
CC_VOLUME = 7          # CC7:通道音量,设静态平衡。
CC_EXPRESSION = 11     # CC11:表情,在 CC7 之下做相对缩放,做乐句内渐强渐弱。
CC_SUSTAIN = 64        # CC64:钢琴延音踏板,>=64 踩下、<64 抬起;只给钢琴/竖琴。
CC_RPN_MSB = 101       # RPN 选择高字节。
CC_RPN_LSB = 100       # RPN 选择低字节。
CC_DATA_MSB = 6        # RPN 数据高字节。
CC_DATA_LSB = 38       # RPN 数据低字节。

PITCHWHEEL_MIN = -8192
PITCHWHEEL_MAX = 8191

DRUM_CHANNEL = 9       # GM 鼓固定通道。


class GmExpression:
    """把 vendor(GM SoundFont)的弯音与 CC 语义集中在一处的工具区。

    奏法函数只调它,日后换音色库或改弯音范围只改这一处。本轮力度/时值/琶音装饰
    用不到弯音,这些方法是为后续弯音类装饰预留的接口。
    """

    def __init__(self, bend_range_semitones=2):
        # 弯音范围决定半音到 14 位弯音值的换算系数;默认 GM 的 ±2 半音。
        self.bend_range_semitones = bend_range_semitones

    def semitones_to_pitch(self, semitones):
        """把半音偏移换算成 pitchwheel 的 14 位整数值(在当前弯音范围下)。"""
        frac = semitones / self.bend_range_semitones
        frac = max(-1.0, min(1.0, frac))  # 夹到 ±1,越界半音先扩范围再调。
        value = round(frac * (PITCHWHEEL_MAX if frac >= 0 else -PITCHWHEEL_MIN))
        return max(PITCHWHEEL_MIN, min(PITCHWHEEL_MAX, value))

    def set_pitchbend_range(self, channel, semitones):
        """返回设弯音范围的 RPN 消息串(相对时序,首条吃 delay 由调用方排)。

        发 RPN 0 即 CC101=0、CC100=0,再用 CC6=半音数 写入,最后关 RPN 防误改。
        """
        self.bend_range_semitones = semitones
        msgs = [
            mido.Message("control_change", channel=channel, control=CC_RPN_MSB, value=0, time=0),
            mido.Message("control_change", channel=channel, control=CC_RPN_LSB, value=0, time=0),
            mido.Message("control_change", channel=channel, control=CC_DATA_MSB, value=semitones, time=0),
            mido.Message("control_change", channel=channel, control=CC_DATA_LSB, value=0, time=0),
            mido.Message("control_change", channel=channel, control=CC_RPN_MSB, value=127, time=0),
            mido.Message("control_change", channel=channel, control=CC_RPN_LSB, value=127, time=0),
        ]
        return msgs

    def bend(self, channel, semitones):
        """返回一条把通道音高弯到指定半音的 pitchwheel 消息。"""
        return mido.Message("pitchwheel", channel=channel,
                            pitch=self.semitones_to_pitch(semitones), time=0)

    def ramp_cc(self, channel, control, start_tick, end_tick, v0, v1, step):
        """返回区间内一串 control_change 台阶(绝对 tick),做 CC11 swell / CC1 颤音渐入。

        值按线性采样;调用方负责把绝对 tick 排进事件流。
        """
        msgs = []
        if end_tick <= start_tick or step <= 0:
            return msgs
        span = end_tick - start_tick
        n = span // step
        for i in range(n + 1):
            tick = start_tick + i * step
            value = round(v0 + (v1 - v0) * (i / n if n else 1))
            value = max(0, min(127, value))
            msgs.append((tick, mido.Message("control_change", channel=channel,
                                            control=control, value=value, time=0)))
        return msgs


#### 力度与时值辅助 ####

def clamp_velocity(value):
    """把力度夹到 MIDI 合法且可闻的 1..127 区间。"""
    return max(1, min(127, int(round(value))))


def ms_to_ticks(ms, tempo, ticks_per_beat):
    """把毫秒换算成 tick(依当前 tempo,tempo 单位为微秒每四分音符)。"""
    return int(round(ms * 1000 * ticks_per_beat / tempo))


#### 绝对事件流:把一条轨拆成带绝对 tick 的事件,改完再差分编码回去 ####

def to_absolute(track):
    """把一条轨的相对 time 展开成 (abs_tick, msg) 列表,保留原顺序。"""
    t = 0
    out = []
    for msg in track:
        t += msg.time
        out.append([t, msg])
    return out


def to_track(events):
    """把 (abs_tick, msg) 列表按 tick 稳定排序后差分编码回一条轨。

    同 tick 内 note_off 先于 note_on,避免同音瞬时叠音被合成器吞掉。
    """
    def sort_key(item):
        tick, msg = item
        # note_off 与力度 0 的 note_on 都算关音,排在同刻发音之前。
        is_off = msg.type == "note_off" or (msg.type == "note_on" and msg.velocity == 0)
        return (tick, 0 if is_off else 1)

    events = sorted(events, key=sort_key)
    track = mido.MidiTrack()
    last = 0
    for tick, msg in events:
        msg.time = max(0, tick - last)
        track.append(msg)
        last = tick
    return track


#### 节拍上下文 ####

def first_tempo(mid):
    """取首个 set_tempo,缺省回 120 BPM 的微秒值。"""
    for tr in mid.tracks:
        for msg in tr:
            if msg.type == "set_tempo":
                return msg.tempo
    return mido.bpm2tempo(120)


def track_end_tick(events):
    """事件流里最大的绝对 tick,作为轨末边界。"""
    return max((t for t, _ in events), default=0)


#### 装饰一:鼓鬼音、backbeat 重音、hi-hat 力度波动 ####

# GM 打击映射里本管线鼓轨用到的键。
SNARE_KEYS = {37, 38, 40}          # SideStick / AcousticSnare / ElectricSnare,均作军鼓族。
HIHAT_KEYS = {42, 44, 46}          # Closed / Pedal / Open hi-hat。
GHOST_NOTE = 38                    # 鬼音用原声军鼓键。
TOMS = [45, 47, 48, 50]            # Low/LowMid/HiMid/High Tom:由低到高,作过门递进。
CRASH = 49                         # Crash Cymbal 1:过门后落在下一小节正拍。
FILL_EVERY = 4                     # 每隔几小节在末拍加一记过门(乐句衔接处)。


def ornament_drums(track, ticks_per_beat, rng):
    """在鼓轨弱位补军鼓鬼音、给 backbeat 军鼓加重音、给 hi-hat 力度波动。

    只增益与补音,不删除也不移动原鼓点。返回新的鼓轨。
    """
    events = to_absolute(track)
    sixteenth = ticks_per_beat // 4
    bar_ticks = ticks_per_beat * 4

    # 收集原有发音点,按拍格归类,供"是否已被占用"判断与重音/波动调整。
    onsets = defaultdict(list)  # abs_tick -> [msg, ...]
    for tick, msg in events:
        if msg.type == "note_on" and msg.velocity > 0:
            onsets[tick].append(msg)

    occupied_sixteenths = set()
    for tick in onsets:
        occupied_sixteenths.add(round(tick / sixteenth))

    end_tick = track_end_tick(events)

    #### backbeat 重音与 hi-hat 波动 ####
    for tick, msgs in onsets.items():
        beat_in_bar = (tick % bar_ticks) / ticks_per_beat
        on_backbeat = abs(beat_in_bar - 1.0) < 0.05 or abs(beat_in_bar - 3.0) < 0.05
        for msg in msgs:
            if msg.note in SNARE_KEYS and on_backbeat:
                # backbeat 军鼓抬到重音区,但不超过 120 留出抖动余量。
                msg.velocity = clamp_velocity(max(msg.velocity, 100) + rng.randint(0, 8))
            elif msg.note in HIHAT_KEYS:
                # hi-hat 在 60-95 间波动,偶发重音冲到 100。
                accent = rng.random() < 0.12
                target = rng.randint(96, 104) if accent else rng.randint(60, 95)
                msg.velocity = clamp_velocity(target)

    #### 弱位补鬼音 ####
    # 在每个 16 分格的弱位(非正拍、且原本空着)按概率插极轻军鼓鬼音。
    ghost_added = 0
    grid = end_tick // sixteenth + 1
    for k in range(grid):
        tick = k * sixteenth
        if k in occupied_sixteenths:
            continue
        sixteenth_in_beat = k % 4  # 0=正拍 e=1 &=2 a=3
        if sixteenth_in_beat == 0:
            continue  # 不在正拍补鬼音,正拍留给原鼓点。
        # e/a(1、3)弱位概率高,& (2) 概率低,贴近放克鬼音落点。
        prob = 0.55 if sixteenth_in_beat in (1, 3) else 0.2
        if rng.random() >= prob:
            continue
        vel = rng.randint(30, 50)
        events.append([tick, mido.Message("note_on", channel=DRUM_CHANNEL,
                                          note=GHOST_NOTE, velocity=vel, time=0)])
        # 鬼音极短,半个 16 分后关音。
        off = tick + max(1, sixteenth // 2)
        events.append([off, mido.Message("note_off", channel=DRUM_CHANNEL,
                                         note=GHOST_NOTE, velocity=0, time=0)])
        ghost_added += 1

    #### 句末过门 ####
    # 每隔 FILL_EVERY 小节,在该小节末拍加一段 16 分音符的 tom 递进过门、力度渐强,并在下一小节正拍落一记 crash,做乐句衔接的推进感。
    fills_added = 0
    nbars = end_tick // bar_ticks
    for b in range(FILL_EVERY - 1, nbars, FILL_EVERY):
        if b + 1 >= nbars:
            continue  # 末小节不加,留出自然收尾。
        base = b * bar_ticks + 3 * ticks_per_beat  # 该小节第 4 拍起。
        rising = rng.random() < 0.7  # 多数上行递进,偶尔下行换花样。
        toms = TOMS if rising else list(reversed(TOMS))
        for i in range(4):
            tick = base + i * sixteenth
            vel = clamp_velocity(72 + i * 12 + rng.randint(-4, 4))  # 渐强冲向下一小节。
            events.append([tick, mido.Message("note_on", channel=DRUM_CHANNEL, note=toms[i], velocity=vel, time=0)])
            events.append([tick + max(1, sixteenth // 2), mido.Message("note_off", channel=DRUM_CHANNEL, note=toms[i], velocity=0, time=0)])
        crash_tick = (b + 1) * bar_ticks
        events.append([crash_tick, mido.Message("note_on", channel=DRUM_CHANNEL, note=CRASH, velocity=clamp_velocity(100 + rng.randint(0, 10)), time=0)])
        events.append([crash_tick + sixteenth * 2, mido.Message("note_off", channel=DRUM_CHANNEL, note=CRASH, velocity=0, time=0)])
        fills_added += 1

    return to_track(events), ghost_added, fills_added


#### 装饰二:和弦琶音化 ####

def arpeggiate_block_chords(track, ticks_per_beat, tempo, rng,
                            spread_ms=(10, 40), min_notes=2):
    """把整块同时触发的和弦做 10-40ms 的琶音化错开(低到高),顶音力度略高。

    单音轨(本身已是琶音)不受影响。返回新轨与错开的和弦数。
    """
    events = to_absolute(track)
    spread_lo = ms_to_ticks(spread_ms[0], tempo, ticks_per_beat)
    spread_hi = ms_to_ticks(spread_ms[1], tempo, ticks_per_beat)

    # 把 note_on / note_off 按 (tick, note) 配对,便于整块识别与同步移位。
    onsets = defaultdict(list)  # tick -> [ [tick,msg], ... ]
    for ev in events:
        msg = ev[1]
        if msg.type == "note_on" and msg.velocity > 0:
            onsets[ev[0]].append(ev)

    chords_done = 0
    for tick, group in onsets.items():
        if len(group) < min_notes:
            continue  # 单音或空,不是块和弦。
        chords_done += 1
        # 低到高排序,逐音递增偏移;顶音(最后一个)力度略高。
        group.sort(key=lambda ev: ev[1].note)
        n = len(group)
        step = (spread_hi - spread_lo) // max(1, n - 1) if n > 1 else 0
        for i, ev in enumerate(group):
            offset = spread_lo + i * step + rng.randint(0, max(1, spread_lo))
            ev[0] += offset
            msg = ev[1]
            if i == n - 1:
                msg.velocity = clamp_velocity(msg.velocity + rng.randint(8, 14))
            else:
                # 内声部略收,顶音更突出。
                msg.velocity = clamp_velocity(msg.velocity - rng.randint(0, 4))

    return to_track(events), chords_done


#### 装饰三:全局 humanize ####

def humanize(track, ticks_per_beat, tempo, rng, is_drum, jitter_ms=(5, 15),
             vel_jitter=8):
    """给每个 note_on 加微时值抖动与力度抖动。

    鼓 pocket 略偏后(偏移整体后移),其它略偏紧(偏移整体前移)。
    note_off 跟随其 note_on 同步移位,保持原音长。
    """
    events = to_absolute(track)
    lo = ms_to_ticks(jitter_ms[0], tempo, ticks_per_beat)
    hi = ms_to_ticks(jitter_ms[1], tempo, ticks_per_beat)
    # pocket:鼓略偏后给正偏置,其它略偏紧给负偏置。
    bias = (lo + hi) // 4
    bias = bias if is_drum else -bias

    # 按 (note, channel) 把 note_on 与其后最近的 note_off 配对,同步位移。
    shifts = {}                   # event index -> 该 note_on 的时值偏移
    open_idx = defaultdict(list)  # (note,ch) -> [尚未配对的 note_on 索引, ...]
    for i, ev in enumerate(events):
        msg = ev[1]
        if msg.type == "note_on" and msg.velocity > 0:
            shift = bias + rng.randint(-(hi - lo), hi - lo)
            ev[0] = max(0, ev[0] + shift)
            shifts[i] = shift  # 给配对的 note_off 用。
            msg.velocity = clamp_velocity(msg.velocity + rng.randint(-vel_jitter, vel_jitter))
            open_idx[(msg.note, msg.channel)].append(i)

    for ev in events:
        msg = ev[1]
        is_off = msg.type == "note_off" or (msg.type == "note_on" and msg.velocity == 0)
        if is_off:
            key = (msg.note, msg.channel)
            if open_idx.get(key):
                on_i = open_idx[key].pop(0)
                # note_off 跟随其 note_on 同步位移,保持原音长;至少落在 note_on 之后。
                ev[0] = max(events[on_i][0] + 1, ev[0] + shifts[on_i])

    return to_track(events)


#### 装饰四:防叠音 ####

def fix_overlaps(track, gap_ticks=2):
    """同轨同音高:前音 note_off 提前到后音 note_on 前 gap_ticks。

    避免同音重触发的瞬时叠音被合成器吞掉。返回新轨与修正次数。
    """
    events = to_absolute(track)

    # 收集每个音高的 (on_tick, on_event) 与 (off_tick, off_event) 序列。
    by_note_on = defaultdict(list)
    by_note_off = defaultdict(list)
    for ev in events:
        msg = ev[1]
        if msg.type == "note_on" and msg.velocity > 0:
            by_note_on[(msg.note, msg.channel)].append(ev)
        elif msg.type == "note_off" or (msg.type == "note_on" and msg.velocity == 0):
            by_note_off[(msg.note, msg.channel)].append(ev)

    fixed = 0
    for key, ons in by_note_on.items():
        offs = by_note_off.get(key, [])
        ons_sorted = sorted(ons, key=lambda e: e[0])
        offs_sorted = sorted(offs, key=lambda e: e[0])
        # 朴素配对:第 i 个 off 对第 i 个 on;若第 i+1 个 on 早于第 i 个 off,提前该 off。
        for i in range(len(ons_sorted) - 1):
            if i >= len(offs_sorted):
                break
            this_off = offs_sorted[i]
            next_on = ons_sorted[i + 1]
            if this_off[0] > next_on[0] - gap_ticks:
                new_off = max(ons_sorted[i][0] + 1, next_on[0] - gap_ticks)
                if new_off < this_off[0]:
                    this_off[0] = new_off
                    fixed += 1

    return to_track(events), fixed


#### 主流程 ####

def is_drum_track(track):
    """轨内出现通道 9 的发音即判为鼓轨。"""
    for msg in track:
        if msg.type in ("note_on", "note_off") and getattr(msg, "channel", None) == DRUM_CHANNEL:
            return True
    return False


def arpeggiation_candidate(track):
    """轨内存在至少一处同 tick 多音齐奏,才值得做琶音化。

    本身已是单音琶音(如吉他分解和弦)不会命中,避免二次错开。
    """
    onsets = defaultdict(int)
    t = 0
    for msg in track:
        t += msg.time
        if msg.type == "note_on" and msg.velocity > 0:
            onsets[t] += 1
    return any(c >= 2 for c in onsets.values())


def process(in_path, out_path, seed=20240620):
    rng = random.Random(seed)
    mid = mido.MidiFile(in_path)
    tempo = first_tempo(mid)
    tpb = mid.ticks_per_beat

    stats = {"ghost_notes": 0, "fills": 0, "arpeggiated_chords": 0, "overlaps_fixed": 0}

    new_tracks = []
    for track in mid.tracks:
        drum = is_drum_track(track)
        if drum:
            track, ghosts, fills = ornament_drums(track, tpb, rng)
            stats["ghost_notes"] += ghosts
            stats["fills"] += fills
        elif arpeggiation_candidate(track):
            track, chords = arpeggiate_block_chords(track, tpb, tempo, rng)
            stats["arpeggiated_chords"] += chords

        track = humanize(track, tpb, tempo, rng, is_drum=drum)
        track, fixed = fix_overlaps(track)
        stats["overlaps_fixed"] += fixed
        new_tracks.append(track)

    out = mido.MidiFile(type=mid.type, ticks_per_beat=tpb)
    out.tracks.extend(new_tracks)
    out.save(out_path)
    return stats


def main(argv):
    if len(argv) != 3:
        print("usage: ornament.py <in.mid> <out.mid>", file=sys.stderr)
        return 2
    stats = process(argv[1], argv[2])
    src = mido.MidiFile(argv[1])
    dst = mido.MidiFile(argv[2])
    src_notes = sum(1 for tr in src.tracks for m in tr if m.type == "note_on" and m.velocity > 0)
    dst_notes = sum(1 for tr in dst.tracks for m in tr if m.type == "note_on" and m.velocity > 0)
    print("ornament done:", argv[1], "->", argv[2])
    print("  note_on: %d -> %d (+%d)" % (src_notes, dst_notes, dst_notes - src_notes))
    print("  ghost_notes=%d fills=%d arpeggiated_chords=%d overlaps_fixed=%d"
          % (stats["ghost_notes"], stats["fills"], stats["arpeggiated_chords"], stats["overlaps_fixed"]))
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv))
