# /// script
# requires-python = ">=3.12"
# dependencies = ["music21", "numpy", "scikit-learn", "mido"]
# ///
# audience: internal
# train-melody-model: 从乐谱语料训练旋律生成用的马尔可夫模型(二阶音高度数 + 一阶时值),导出紧凑 JSON 供运行期离线采样。
# 音阶归一:pentatonic(民歌,以末音为主音)、diatonic(流行/动漫,按调号归一;--mode 可只留大调或小调)。
# 聚类:--cluster K 把语料按音区与音域聚成 K 个内聚子库(不同音域作不同库),各写一个 <out>-c<i>.json,按音区由低到高编号。
# 来源:--esac / --m21files 读 music21 自带 essenFolksong;--dir 递归读目录下的 MusicXML/MIDI(取最高声部、和弦取顶音作主旋律)。
# 运行: uv run --python 3.12 tools/train-melody-model.py --style <名> (--esac|--m21files a,b|--dir D) --scale <pentatonic|diatonic> [--mode major|minor] [--cluster K] --out <路径> [--limit N]

import argparse
import glob
import json
import os
import sys
import collections
from music21 import corpus, converter, stream, note as m21note

DURS = [0.25, 0.5, 0.75, 1.0, 1.5, 2.0, 3.0, 4.0]
def quantize(q):
    return min(DURS, key=lambda d: abs(d - q))

#### 取一首乐谱的主旋律 [(MIDI, 量化时值)]:单声部直取,多声部取最高声部、和弦取顶音 ####
def melody_notes(score, single_voice):
    if single_voice:
        part = score
    else:
        parts = list(score.parts) if score.parts else [score]
        def mean_pitch(p):
            ms = [n for n in p.flatten().notes]
            if not ms:
                return -1
            return sum((max(n.pitches).midi if n.isChord else n.pitch.midi) for n in ms) / len(ms)
        part = max(parts, key=mean_pitch)
    out = []
    for n in part.flatten().notes:
        midi = max(n.pitches).midi if n.isChord else n.pitch.midi
        out.append((midi, quantize(float(n.duration.quarterLength))))
    return out

# 各音阶的音级(相对主音半音):和弦根音吸附到最近的音阶级,取其序号,使学到的和弦转移与 composer 的 triad(序号) 同一坐标系。
SCALE_PCS = {'diatonic': [0, 2, 4, 5, 7, 9, 11], 'minor': [0, 2, 3, 5, 7, 8, 10]}

#### 把相对主音的音级(0-11)吸附到最近的音阶级,返回其序号 ####
def nearest_scale_index(pc, scale_pcs):
    best_i, best_d = 0, 99
    for i, s in enumerate(scale_pcs):
        d = min((pc - s) % 12, (s - pc) % 12)
        if d < best_d:
            best_d, best_i = d, i
    return best_i

#### 把音符转成相对主音的半音度数;按需筛调性。返回 (degrees, tonic_pc) 或 (None, None)(被调性筛掉) ####
def to_degrees(notes, scale, want_mode):
    midis = [m for (m, _) in notes]
    if scale == 'pentatonic':
        tonic = midis[-1]
        return [m - tonic for m in midis], tonic % 12
    s = stream.Stream()
    for m in midis:
        s.append(m21note.Note(midi=m))
    k = s.analyze('key')
    if want_mode:
        if k.mode != want_mode:
            return None, None
        tonic_pc = k.tonic.pitchClass
    else:
        tonic_pc = (k.tonic.pitchClass + 3) % 12 if k.mode == 'minor' else k.tonic.pitchClass
    shift = (-tonic_pc) % 12
    if shift > 6:
        shift -= 12
    return [(m + shift) - 60 for m in midis], tonic_pc

#### 从多声部乐谱识别和弦进行:chordify 取每个纵向和弦的根音(相对主音吸附到音阶级序号)与时值,合并连续同根,返回 [(序号, 时值)] ####
def extract_chords(score, tonic_pc, scale_pcs):
    try:
        ch = score.chordify()
    except Exception:
        return None
    seq = []
    for c in ch.recurse().getElementsByClass('Chord'):
        r = c.root()
        if r is None:
            continue
        pc = (r.pitchClass - tonic_pc) % 12
        idx = nearest_scale_index(pc, scale_pcs)
        dur = quantize(float(c.quarterLength))
        if seq and seq[-1][0] == idx:
            seq[-1] = (idx, seq[-1][1] + dur)  # 合并连续同根,得真正的和弦更替与和声节奏
        else:
            seq.append((idx, dur))
    return seq if len(seq) >= 3 else None

#### 音名到音级(0-11),含升降号别名 ####
NOTE_PC = {'C': 0, 'B#': 0, 'C#': 1, 'Db': 1, 'D': 2, 'D#': 3, 'Eb': 3, 'E': 4, 'Fb': 4,
           'E#': 5, 'F': 5, 'F#': 6, 'Gb': 6, 'G': 7, 'G#': 8, 'Ab': 8, 'A': 9, 'A#': 10,
           'Bb': 10, 'B': 11, 'Cb': 11}

#### 读 POP909 一首 MIDI 的 MELODY(人声主旋律)轨,返回 [(midi, 起tick, 止tick)] 与 ticks/beat、bpm ####
def pop909_melody(mid_path):
    import mido
    mid = mido.MidiFile(mid_path)
    tpb = mid.ticks_per_beat
    tempos = [m.tempo for t in mid.tracks for m in t if m.type == 'set_tempo']
    bpm = mido.tempo2bpm(tempos[0]) if tempos else 120.0
    for t in mid.tracks:
        if any(x.type == 'track_name' and x.name == 'MELODY' for x in t):
            cur, on, out = 0, {}, []
            for m in t:
                cur += m.time
                if m.type == 'note_on' and m.velocity > 0:
                    on[m.note] = cur
                elif m.type == 'note_off' or (m.type == 'note_on' and m.velocity == 0):
                    if m.note in on:
                        out.append((m.note, on.pop(m.note), cur))
            out.sort(key=lambda x: x[1])
            return out, tpb, bpm
    return [], tpb, bpm

#### 从 POP909 语料读人声主旋律与逐拍和弦:每首取 MELODY 轨当主旋律(单声部、可唱)、chord_midi.txt 当真实和声进行;按 want_mode 筛大小调 ####
# 用 key_audio.txt 给定的调直接归一到相对主音度数(不必再做调性识别);和弦根音吸附到音阶级序号,与 composer 的 triad(序号) 同坐标系。
def read_pop909(root, want_mode):
    tunes = []
    for d in sorted(glob.glob(os.path.join(root, '[0-9][0-9][0-9]'))):
        try:
            with open(os.path.join(d, 'key_audio.txt'), encoding='utf-8') as f:
                keyname = f.readline().split('\t')[2].strip()
            root_str, qual = keyname.split(':')
            mode = 'major' if qual.startswith('maj') else 'minor'
            if want_mode and mode != want_mode:
                continue
            tonic_pc = NOTE_PC[root_str]
            shift = (-tonic_pc) % 12
            if shift > 6:
                shift -= 12
            mel, tpb, bpm = pop909_melody(os.path.join(d, os.path.basename(d) + '.mid'))
            if len(mel) < 6:
                continue
            degs = [(midi + shift) - 60 for (midi, _, _) in mel]
            if max(degs) > 21 or min(degs) < -16:
                continue
            durs = [quantize((e - s) / tpb) for (_, s, e) in mel]
            scale_pcs = SCALE_PCS['minor'] if mode == 'minor' else SCALE_PCS['diatonic']
            seq = []
            with open(os.path.join(d, 'chord_midi.txt'), encoding='utf-8') as f:
                for line in f:
                    parts = line.split('\t')
                    if len(parts) < 3:
                        continue
                    name = parts[2].strip()
                    if name == 'N' or ':' not in name:
                        continue
                    pc = (NOTE_PC[name.split(':')[0]] - tonic_pc) % 12
                    idx = nearest_scale_index(pc, scale_pcs)
                    dur = quantize((float(parts[1]) - float(parts[0])) * bpm / 60.0)
                    if seq and seq[-1][0] == idx:
                        seq[-1] = (idx, seq[-1][1] + dur)
                    else:
                        seq.append((idx, dur))
            chords = seq if len(seq) >= 3 else None
            tunes.append((degs, durs, chords))
        except Exception as e:
            print(f"  跳过 {d}: {e}", file=sys.stderr)
    return tunes

#### 从若干首(degrees, durs, chords)建一份马尔可夫模型;chords 可为 None(单声部无和声) ####
def build_model(tlist, scale):
    pitch2 = collections.defaultdict(collections.Counter)
    dur1 = collections.defaultdict(collections.Counter)
    starts = collections.Counter()
    dur_start = collections.Counter()
    chord_trans = collections.defaultdict(collections.Counter)  # 和弦根音序号的一阶转移
    chord_dur = collections.Counter()                            # 和声节奏:每个和弦持续的拍数分布
    chord_start = collections.Counter()                          # 起始和弦序号
    chord_tunes = 0
    all_degs = []
    for degs, durs, chords in tlist:
        all_degs.extend(degs)
        starts[(degs[0], degs[1])] += 1
        dur_start[durs[0]] += 1
        for i in range(2, len(degs)):
            pitch2[(degs[i - 2], degs[i - 1])][degs[i]] += 1
        for i in range(1, len(durs)):
            dur1[durs[i - 1]][durs[i]] += 1
        if chords:
            chord_tunes += 1
            chord_start[chords[0][0]] += 1
            for idx, dur in chords:
                chord_dur[dur] += 1
            for i in range(1, len(chords)):
                chord_trans[chords[i - 1][0]][chords[i][0]] += 1
    # 音域直接学自语料:取相对主音度数的 3/97 百分位作可唱窗口(剔除个别极值),让生成旋律落在源歌手实际唱过的音区。
    sd = sorted(all_degs)
    def pctl(p):
        return sd[max(0, min(len(sd) - 1, int(p / 100 * len(sd))))] if sd else 0
    model = {
        "scale": scale,
        "pitch2": {f"{a},{b}": dict(c) for (a, b), c in pitch2.items()},
        "dur1": {str(a): {str(k): v for k, v in c.items()} for a, c in dur1.items()},
        "starts": {f"{a},{b}": v for (a, b), v in starts.items()},
        "durStart": {str(k): v for k, v in dur_start.items()},
        "register": {"lo": pctl(3), "hi": pctl(97)},
        "tunes": len(tlist),
    }
    if chord_tunes:
        model["chordTrans"] = {str(a): {str(k): v for k, v in c.items()} for a, c in chord_trans.items()}
        model["chordStart"] = {str(k): v for k, v in chord_start.items()}
        model["chordDur"] = {str(k): v for k, v in chord_dur.items()}
        model["chordTunes"] = chord_tunes
    return model

def write_model(model, path):
    os.makedirs(os.path.dirname(path), exist_ok=True)
    with open(path, "w", encoding="utf-8") as f:
        json.dump(model, f, ensure_ascii=False, separators=(",", ":"))

def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--style', required=True)
    ap.add_argument('--esac', action='store_true')
    ap.add_argument('--m21files')
    ap.add_argument('--dir')
    ap.add_argument('--pop909', help='POP909 的 POP909/ 目录:取各曲 MELODY 轨当人声主旋律、chord_midi.txt 当和声')
    ap.add_argument('--scale', choices=['pentatonic', 'diatonic'], required=True)
    ap.add_argument('--mode', choices=['major', 'minor'])
    ap.add_argument('--cluster', type=int, default=0)
    ap.add_argument('--melody-only', action='store_true', help='只学旋律,不做和弦识别(单声部人声语料如 Kiritan 用):和声另行嫁接')
    ap.add_argument('--out', required=True)
    ap.add_argument('--limit', type=int, default=0)
    args = ap.parse_args()
    out_scale = 'minor' if args.mode == 'minor' else args.scale

    sources = []
    m21files = ['essenFolksong/han1.abc', 'essenFolksong/han2.abc'] if args.esac else []
    if args.m21files:
        m21files = [f if '/' in f else f'essenFolksong/{f}' for f in args.m21files.split(',')]
    for fname in m21files:
        opus = corpus.parse(fname)
        for s in (list(opus.scores) if hasattr(opus, 'scores') else [opus]):
            sources.append((s, True))
    if args.dir:
        files = sorted(glob.glob(os.path.join(args.dir, '**', '*.xml'), recursive=True)
                       + glob.glob(os.path.join(args.dir, '**', '*.musicxml'), recursive=True)
                       + glob.glob(os.path.join(args.dir, '**', '*.mid'), recursive=True))
        if args.limit:
            files = files[:args.limit]
        sources += [(f, False) for f in files]

    tunes = []  # (degs, durs, chords)
    if args.pop909:
        tunes += read_pop909(args.pop909, args.mode)
        print(f"  POP909 读入 {len(tunes)} 首({args.mode or '全部'}调)", file=sys.stderr)
    scale_pcs = SCALE_PCS['minor'] if args.mode == 'minor' else SCALE_PCS.get(args.scale)
    for src, single in sources:
        try:
            score = src if single else converter.parse(src)
            notes = melody_notes(score, single)
            if len(notes) < 6:
                continue
            degs, tonic_pc = to_degrees(notes, args.scale, args.mode)
            if degs is None:
                continue
            if max(degs) > 21 or min(degs) < -16:
                continue
            # 多声部且非五声(动漫吉他谱)时,从纵向和声识别和弦进行;和弦识别失败不拖累旋律,单独兜底为 None。
            chords = None
            if not single and scale_pcs is not None and not args.melody_only:
                try:
                    chords = extract_chords(score, tonic_pc, scale_pcs)
                except Exception:
                    chords = None
            tunes.append((degs, [d for (_, d) in notes], chords))
        except Exception as e:
            print(f"  跳过 {src if isinstance(src, str) else 'score'}: {e}", file=sys.stderr)

    if args.cluster and args.cluster > 1 and len(tunes) >= args.cluster:
        import numpy as np
        from sklearn.cluster import KMeans
        feats = np.array([[float(np.mean(d)), float(max(d) - min(d))] for d, _, _ in tunes])
        z = (feats - feats.mean(0)) / (feats.std(0) + 1e-9)
        labels = KMeans(n_clusters=args.cluster, n_init=10, random_state=0).fit_predict(z)
        order = sorted(range(args.cluster), key=lambda c: feats[labels == c, 0].mean())  # 按音区低到高编号
        base = args.out[:-5] if args.out.endswith('.json') else args.out
        for newi, c in enumerate(order):
            tl = [tunes[i] for i in range(len(tunes)) if labels[i] == c]
            model = build_model(tl, out_scale)
            model['register'] = round(float(feats[labels == c, 0].mean()), 1)  # 平均音区(相对主音半音)
            model['span'] = round(float(feats[labels == c, 1].mean()), 1)      # 平均音域跨度
            path = f"{base}-c{newi}.json"
            write_model(model, path)
            print(f"风格 {args.style} 簇 c{newi}({out_scale}):{len(tl)} 首,音区 {model['register']}、跨度 {model['span']},写出 {path}({os.path.getsize(path)} 字节)")
    else:
        write_model(build_model(tunes, out_scale), args.out)
        print(f"风格 {args.style}({out_scale}):训练 {len(tunes)} 首,写出 {args.out}({os.path.getsize(args.out)} 字节)")

main()
