# /// script
# requires-python = ">=3.12"
# dependencies = ["mido"]
# ///
# audience: internal
# expression
#
# mido 表现性装饰后处理:读入 MMA + arrange-midi.py 出的伴奏 MIDI,只用 GM SoundFont
# (GeneralUser GS + FluidSynth)能表达的手段给各乐器加「表情」,输出加装饰后的 MIDI。
# 与 ornament.py 互补:ornament.py 管力度/时值/琶音/鬼音(纯音符模式),本文件管
# 表现性控制器与弯音:
#   1. 弦乐 / pad 长音:CC11 表情包络做轻起—涨峰—回落的 < > 渐强渐弱;CC1 颤音从 0
#      渐拉到中等,长音后段加揉弦。
#   2. 主奏 Lead 轨:相邻同向两音之间偶尔用 pitchwheel 做小幅滑音 / 推弦(先 RPN 设
#      弯音范围),长音上加颤音。Lead 独占其通道才安全。
#   3. 全体(鼓除外的音高乐器):力度轻度塑形——乐句内渐强、强拍重音,不破坏既有节奏。
#
# GM 约束:CC1 控颤音 LFO 音高深度(揉弦),CC11 在 CC7 之下做相对音量缩放(表情),
# pitchwheel 默认 ±2 半音(用 RPN 改)。弯音与 CC1 按通道生效,需独占通道才安全。
# 鼓通道 9 不加弯音 / 颤音,只做力度塑形。半音↔弯音换算与 RPN 写法参考 ornament.py 的
# GmExpression,本文件内置一份等价工具区,保持「只新建自己的文件、不改共享脚本」。
#
# 运行前提:GeneralUser GS(GM SoundFont)+ FluidSynth 渲染,鼓固定在 MIDI 通道 9。
# 全局不变量:CC1/CC11/pitchwheel 只施加于独占该通道的表现性轨,共享通道(MMA 块和弦
# 轨)不碰,避免控制器串扰带跑同通道的和弦音。所有随机走同一固定种子,产物可复现。
#
# 命令行:uv run --python 3.12 --with mido archive/expression.py <in.mid> <out.mid>

import sys
import random
from collections import defaultdict

import mido


#### GM CC 语义与 pitchwheel 换算工具区 ####

CC_MODULATION = 1      # CC1:在 GeneralUser GS 上控制颤音 LFO 音高深度(揉弦)。
CC_EXPRESSION = 11     # CC11:表情,在 CC7 之下做相对缩放,做乐句内渐强渐弱。
CC_RPN_MSB = 101       # RPN 选择高字节。
CC_RPN_LSB = 100       # RPN 选择低字节。
CC_DATA_MSB = 6        # RPN 数据高字节。
CC_DATA_LSB = 38       # RPN 数据低字节。

PITCHWHEEL_MIN = -8192
PITCHWHEEL_MAX = 8191

DRUM_CHANNEL = 9       # GM 鼓固定通道。

LEAD_BEND_RANGE = 2    # Lead 滑音 / 推弦的弯音范围(半音),小幅推弦 ±2 足够。


class GmExpression:
    """把 vendor(GM SoundFont)的弯音与 CC 语义集中在一处的工具区。

    奏法函数只调它,日后换音色库或改弯音范围只改这一处。半音换算与 RPN 写法与
    ornament.py 的同名工具等价,此处自带一份以免依赖共享脚本。
    """

    def __init__(self, bend_range_semitones=2):
        # 弯音范围决定半音到 14 位弯音值的换算系数;默认 GM 的 ±2 半音。
        self.bend_range_semitones = bend_range_semitones

    def semitones_to_pitch(self, semitones):
        """把半音偏移换算成 pitchwheel 的 14 位整数值(在当前弯音范围下)。"""
        frac = semitones / self.bend_range_semitones
        frac = max(-1.0, min(1.0, frac))  # 夹到 ±1,越界先扩范围再调。
        value = round(frac * (PITCHWHEEL_MAX if frac >= 0 else -PITCHWHEEL_MIN))
        return max(PITCHWHEEL_MIN, min(PITCHWHEEL_MAX, value))

    def set_pitchbend_range_msgs(self, channel, semitones):
        """返回设弯音范围的 RPN 消息串(time 均为 0,由调用方排进绝对时序)。

        发 RPN 0 即 CC101=0、CC100=0,再用 CC6=半音数写入,最后关 RPN 防误改。
        """
        self.bend_range_semitones = semitones
        return [
            mido.Message("control_change", channel=channel, control=CC_RPN_MSB, value=0, time=0),
            mido.Message("control_change", channel=channel, control=CC_RPN_LSB, value=0, time=0),
            mido.Message("control_change", channel=channel, control=CC_DATA_MSB, value=semitones, time=0),
            mido.Message("control_change", channel=channel, control=CC_DATA_LSB, value=0, time=0),
            mido.Message("control_change", channel=channel, control=CC_RPN_MSB, value=127, time=0),
            mido.Message("control_change", channel=channel, control=CC_RPN_LSB, value=127, time=0),
        ]

    def bend_msg(self, channel, semitones):
        """返回一条把通道音高弯到指定半音的 pitchwheel 消息(time=0)。"""
        return mido.Message("pitchwheel", channel=channel,
                            pitch=self.semitones_to_pitch(semitones), time=0)

    def ramp_cc(self, channel, control, start_tick, end_tick, v0, v1, step, ease=False):
        """返回区间内一串 control_change 台阶(绝对 tick),做 CC11 swell / CC1 颤音渐入。

        ease=True 时用平滑的 smoothstep 缓动取代直线,避免 GM 上「鼠标画直线」的死板感。
        返回 [(abs_tick, msg), ...],调用方负责排进事件流。
        """
        msgs = []
        if end_tick <= start_tick or step <= 0:
            return msgs
        span = end_tick - start_tick
        n = max(1, span // step)
        for i in range(n + 1):
            tick = start_tick + i * step
            frac = i / n
            if ease:
                frac = frac * frac * (3 - 2 * frac)  # smoothstep,两端慢中间快。
            value = round(v0 + (v1 - v0) * frac)
            value = max(0, min(127, value))
            msgs.append((tick, mido.Message("control_change", channel=channel,
                                            control=control, value=value, time=0)))
        return msgs


#### 力度辅助 ####

def clamp_velocity(value):
    """把力度夹到 MIDI 合法且可闻的 1..127 区间。"""
    return max(1, min(127, int(round(value))))


#### 绝对事件流:把一条轨拆成带绝对 tick 的事件,改完再差分编码回去 ####

def to_absolute(track):
    """把一条轨的相对 time 展开成 [abs_tick, msg] 列表,保留原顺序。"""
    t = 0
    out = []
    for msg in track:
        t += msg.time
        out.append([t, msg])
    return out


def to_track(events):
    """把 [abs_tick, msg] 列表按 tick 稳定排序后差分编码回一条轨。

    同 tick 内 note_off 先于 note_on;控制器(含 pitchwheel)排在发音之前,
    确保音符起振时表情 / 弯音已就位。
    """
    def sort_key(item):
        tick, msg = item
        if msg.type == "note_off" or (msg.type == "note_on" and msg.velocity == 0):
            order = 0  # 关音最先。
        elif msg.type in ("control_change", "pitchwheel", "program_change"):
            order = 1  # 控制器其次,音符起振时已就位。
        else:
            order = 2  # note_on 最后。
        return (tick, order)

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


#### 轨道识别 ####

# GM program 音色族:用音色判断该轨配哪类表现装饰。
STRINGS_PROGRAMS = set(range(40, 52))   # 40-51:弦乐 / 合奏弦 / 弦乐铺底族(含 SynthStrings)。


def track_meta(track):
    """读出一条轨的名字、note 通道集合、各通道的 program。

    返回 (name, note_channels, programs)。鼓轨可由 note_channels 含 9 判出。
    """
    name = None
    note_channels = set()
    programs = {}
    for msg in track:
        if msg.type == "track_name":
            name = msg.name
        elif msg.type == "program_change":
            programs[msg.channel] = msg.program
        elif msg.type in ("note_on", "note_off"):
            note_channels.add(getattr(msg, "channel", None))
    return name, note_channels, programs


def exclusive_note_channels(mid):
    """统计每个通道被几条轨用作发音通道,返回只被单轨独占的通道集合。

    弯音与 CC1 按通道生效,只有独占通道的轨才能安全施加,否则会串扰同通道其它轨。
    """
    channel_track_count = defaultdict(int)
    for track in mid.tracks:
        _, note_channels, _ = track_meta(track)
        for ch in note_channels:
            channel_track_count[ch] += 1
    return {ch for ch, n in channel_track_count.items() if n == 1}


def is_strings_track(programs):
    """轨内任一发音通道的 program 落在弦乐族,即判为弦乐 / pad 轨。"""
    return any(p in STRINGS_PROGRAMS for p in programs.values())


#### 装饰一:弦乐 / pad 长音 CC11 表情包络 + CC1 颤音渐入 ####

# 长音阈值:时值不短于约半拍的音才值得做表情包络与揉弦。
LONG_NOTE_BEATS = 0.5
# CC11 swell 包络:从轻起爬到峰再回落。
SWELL_V0 = 55
SWELL_PEAK = 118
SWELL_V1 = 78
# CC1 颤音:长音前段直音(0),后段渐拉到中等深度做揉弦。
VIBRATO_PEAK = 70
VIBRATO_DELAY_FRAC = 0.4   # 音长前 40% 直音,之后起振。
# 控制器台阶间隔(tick),约对应几十毫秒一档。
RAMP_STEP = 16


def collect_notes(events):
    """把事件流里的 note_on 与其配对 note_off 收成 [(on_tick, off_tick, note, channel, on_msg), ...]。"""
    notes = []
    open_n = defaultdict(list)
    for ev in events:
        tick, msg = ev
        if msg.type == "note_on" and msg.velocity > 0:
            open_n[(msg.note, getattr(msg, "channel", None))].append((tick, msg))
        elif msg.type == "note_off" or (msg.type == "note_on" and msg.velocity == 0):
            key = (msg.note, getattr(msg, "channel", None))
            if open_n.get(key):
                on_tick, on_msg = open_n[key].pop(0)
                notes.append((on_tick, tick, msg.note, key[1], on_msg))
    return notes


def add_strings_expression(track, channel, ticks_per_beat, gm, stats):
    """在弦乐 / pad 轨的长音上写 CC11 swell 与 CC1 颤音渐入。

    每个长音独立做一条 < > 表情包络;CC1 前段直音、后段渐拉到中等揉弦。
    返回新轨。channel 必须是该轨独占的发音通道。
    """
    events = to_absolute(track)
    notes = collect_notes(events)
    long_threshold = int(LONG_NOTE_BEATS * ticks_per_beat)

    # 多音齐奏的块和弦共享同一通道的表情包络,按起始 tick 归并避免重复写。
    spans = {}  # on_tick -> off_tick(取该起点上最长的音作为包络跨度)
    for on_tick, off_tick, note, ch, _ in notes:
        if off_tick - on_tick < long_threshold:
            continue
        spans[on_tick] = max(spans.get(on_tick, off_tick), off_tick)

    for on_tick, off_tick in spans.items():
        span = off_tick - on_tick
        mid_tick = on_tick + span // 2
        # CC11:前半段轻起涨到峰,后半段回落,形成 < > 。
        rise = gm.ramp_cc(channel, CC_EXPRESSION, on_tick, mid_tick, SWELL_V0, SWELL_PEAK, RAMP_STEP, ease=True)
        fall = gm.ramp_cc(channel, CC_EXPRESSION, mid_tick, off_tick, SWELL_PEAK, SWELL_V1, RAMP_STEP, ease=True)
        # CC1:前段保持直音,后段渐拉到揉弦峰值。
        vib_start = on_tick + int(span * VIBRATO_DELAY_FRAC)
        vib = gm.ramp_cc(channel, CC_MODULATION, vib_start, off_tick, 0, VIBRATO_PEAK, RAMP_STEP, ease=True)
        # 直音段先压一条 CC1=0,确保起振时没有残留颤音。
        events.append((on_tick, mido.Message("control_change", channel=channel,
                                             control=CC_MODULATION, value=0, time=0)))
        for tick, msg in rise + fall:
            events.append((tick, msg))
            stats["cc11"] += 1
        for tick, msg in vib:
            events.append((tick, msg))
            stats["cc1"] += 1
        # 音尾把 CC1 收回,避免渗到下一个音的直音段。
        events.append((off_tick, mido.Message("control_change", channel=channel,
                                              control=CC_MODULATION, value=0, time=0)))
        stats["cc1"] += 1

    return to_track(events)


#### 装饰二:Lead 滑音 / 推弦 + 长音颤音 ####

# 相邻两音判为「同向小跳」的音程上限(半音);超过则不滑,避免大跳推弦失真。
SLIDE_MAX_INTERVAL = 4
# 滑音触发概率,偶尔为之而非每处都滑,免得机械。
SLIDE_PROB = 0.35
# 滑音时长:在后音起振前这么多 tick 内把弯音从上一音推到本音。
SLIDE_DUR_TICKS = 60
SLIDE_STEP = 10
# Lead 长音颤音:时值不短于约一拍的音才加。
LEAD_VIBRATO_BEATS = 1.0
LEAD_VIBRATO_PEAK = 55


def add_lead_expression(track, channel, ticks_per_beat, gm, rng, stats):
    """给 Lead 轨加滑音 / 推弦与长音颤音。

    滑音:相邻同向小跳的后音,在其起振前用 pitchwheel 从前音音高推到本音(到位即归零)。
    颤音:长音上 CC1 从 0 渐拉到中等深度。channel 必须是 Lead 独占的发音通道。
    返回新轨。
    """
    events = to_absolute(track)
    gm.set_bend_range_local = LEAD_BEND_RANGE
    notes = sorted(collect_notes(events), key=lambda n: n[0])

    # 轨首设弯音范围(RPN),并把弯音初始化为 0。
    rpn = gm.set_pitchbend_range_msgs(channel, LEAD_BEND_RANGE)
    for m in rpn:
        events.append((0, m))
    events.append((0, mido.Message("pitchwheel", channel=channel, pitch=0, time=0)))

    long_threshold = int(LEAD_VIBRATO_BEATS * ticks_per_beat)

    prev = None
    for note in notes:
        on_tick, off_tick, pitch, ch, on_msg = note
        #### 滑音 / 推弦:相邻同向小跳偶尔触发 ####
        if prev is not None:
            prev_on, prev_off, prev_pitch = prev[0], prev[1], prev[2]
            interval = pitch - prev_pitch
            # 同向:这里用「与前一音的相对高低」做最小判据,小跳且非同音。
            small_step = 0 < abs(interval) <= SLIDE_MAX_INTERVAL
            if small_step and rng.random() < SLIDE_PROB:
                # 在后音起振前 SLIDE_DUR_TICKS 内,从「前音→本音」的音程差推到 0。
                start = max(prev_off, on_tick - SLIDE_DUR_TICKS)
                # 起点把弯音预置到 -interval(听感:从前音音高滑上 / 下到本音)。
                ramp = gm.ramp_cc  # 复用台阶生成的线性插值思路,但目标是 pitchwheel。
                n = max(1, (on_tick - start) // SLIDE_STEP)
                for i in range(n + 1):
                    t = start + i * (on_tick - start) // n
                    frac = i / n
                    frac = frac * frac * (3 - 2 * frac)  # ease-out 风格的 smoothstep。
                    semis = -interval * (1 - frac)
                    events.append((t, gm.bend_msg(channel, semis)))
                    stats["pitchwheel"] += 1
                # 后音起振点确保弯音归零。
                events.append((on_tick, mido.Message("pitchwheel", channel=channel, pitch=0, time=0)))
                stats["pitchwheel"] += 1

        #### 长音颤音 ####
        if off_tick - on_tick >= long_threshold:
            vib_start = on_tick + int((off_tick - on_tick) * VIBRATO_DELAY_FRAC)
            events.append((on_tick, mido.Message("control_change", channel=channel,
                                                 control=CC_MODULATION, value=0, time=0)))
            for tick, msg in gm.ramp_cc(channel, CC_MODULATION, vib_start, off_tick, 0, LEAD_VIBRATO_PEAK, RAMP_STEP, ease=True):
                events.append((tick, msg))
                stats["cc1"] += 1
            events.append((off_tick, mido.Message("control_change", channel=channel,
                                                  control=CC_MODULATION, value=0, time=0)))
            stats["cc1"] += 1

        prev = note

    return to_track(events)


#### 装饰三:全体音高乐器力度塑形(乐句渐强 + 强拍重音) ####

# 乐句长度(以小节计):每个乐句内做一条轻度渐强曲线。
PHRASE_BARS = 2
# 渐强幅度:乐句首到乐句末力度抬升的上限。
PHRASE_SWELL = 10
# 强拍重音:落在小节强拍(第 1、3 拍)的音加的力度。
DOWNBEAT_ACCENT = 6


def shape_velocity(track, ticks_per_beat, stats):
    """对一条音高轨做轻度力度塑形:乐句内线性渐强 + 强拍重音。

    只改 note_on 力度,不动时值与发音点,不破坏既有节奏。鼓轨不调用本函数。
    返回新轨。
    """
    events = to_absolute(track)
    bar_ticks = ticks_per_beat * 4
    phrase_ticks = bar_ticks * PHRASE_BARS

    for ev in events:
        tick, msg = ev
        if not (msg.type == "note_on" and msg.velocity > 0):
            continue
        # 乐句内位置:0(句首)→1(句末)线性抬升。
        pos = (tick % phrase_ticks) / phrase_ticks
        swell = PHRASE_SWELL * pos
        # 强拍重音:第 1、3 拍(以拍为单位)。
        beat_in_bar = (tick % bar_ticks) / ticks_per_beat
        on_downbeat = abs(beat_in_bar - 0.0) < 0.05 or abs(beat_in_bar - 2.0) < 0.05
        accent = DOWNBEAT_ACCENT if on_downbeat else 0
        new_vel = clamp_velocity(msg.velocity + swell + accent)
        if new_vel != msg.velocity:
            stats["velocity_shaped"] += 1
        msg.velocity = new_vel

    return to_track(events)


#### 主流程 ####

def process(in_path, out_path, seed=20240620):
    rng = random.Random(seed)
    mid = mido.MidiFile(in_path)
    tpb = mid.ticks_per_beat
    gm = GmExpression()

    exclusive = exclusive_note_channels(mid)
    stats = {"cc11": 0, "cc1": 0, "pitchwheel": 0, "velocity_shaped": 0,
             "strings_tracks": 0, "lead_tracks": 0, "shaped_tracks": 0}
    channels_touched = {"cc11": set(), "cc1": set(), "pitchwheel": set()}

    new_tracks = []
    for track in mid.tracks:
        name, note_channels, programs = track_meta(track)
        is_drum = DRUM_CHANNEL in note_channels
        note_chs = sorted(c for c in note_channels if c is not None)

        # 表现性轨须独占其单一发音通道,否则 CC1/弯音会串扰同通道其它轨。
        single_ch = note_chs[0] if len(note_chs) == 1 else None
        is_exclusive = single_ch is not None and single_ch in exclusive

        if not is_drum and single_ch is not None:
            #### 弦乐 / pad:CC11 swell + CC1 颤音(允许块和弦共享通道的铺底轨) ####
            if is_strings_track(programs):
                before = (stats["cc11"], stats["cc1"])
                track = add_strings_expression(track, single_ch, tpb, gm, stats)
                stats["strings_tracks"] += 1
                if stats["cc11"] > before[0]:
                    channels_touched["cc11"].add(single_ch)
                if stats["cc1"] > before[1]:
                    channels_touched["cc1"].add(single_ch)
            #### Lead:滑音 / 推弦 + 长音颤音,仅在独占通道上做(弯音安全) ####
            elif name == "Lead" and is_exclusive:
                before = (stats["pitchwheel"], stats["cc1"])
                track = add_lead_expression(track, single_ch, tpb, gm, rng, stats)
                stats["lead_tracks"] += 1
                if stats["pitchwheel"] > before[0]:
                    channels_touched["pitchwheel"].add(single_ch)
                if stats["cc1"] > before[1]:
                    channels_touched["cc1"].add(single_ch)

        #### 力度塑形:除鼓外的全体音高轨 ####
        if not is_drum:
            track = shape_velocity(track, tpb, stats)
            stats["shaped_tracks"] += 1

        new_tracks.append(track)

    out = mido.MidiFile(type=mid.type, ticks_per_beat=tpb)
    out.tracks.extend(new_tracks)
    out.save(out_path)
    stats["channels"] = {k: sorted(v) for k, v in channels_touched.items()}
    return stats


def main(argv):
    if len(argv) != 3:
        print("usage: expression.py <in.mid> <out.mid>", file=sys.stderr)
        return 2
    stats = process(argv[1], argv[2])
    print("expression done:", argv[1], "->", argv[2])
    print("  strings_tracks=%d lead_tracks=%d shaped_tracks=%d"
          % (stats["strings_tracks"], stats["lead_tracks"], stats["shaped_tracks"]))
    print("  CC11(表情)=%d 事件,作用通道 %s"
          % (stats["cc11"], stats["channels"]["cc11"]))
    print("  CC1(颤音)=%d 事件,作用通道 %s"
          % (stats["cc1"], stats["channels"]["cc1"]))
    print("  pitchwheel(滑音/推弦)=%d 事件,作用通道 %s"
          % (stats["pitchwheel"], stats["channels"]["pitchwheel"]))
    print("  力度塑形音符数=%d" % stats["velocity_shaped"])
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv))
