# /// script
# requires-python = ">=3.12"
# dependencies = ["music21"]
# ///
# audience: internal
# train-chord-model: 从带和弦标注的乐谱语料学一张和声转移表(和弦级序号的一阶马尔可夫 + 起始分布 + 和声节奏时长),导出 JSON 供 composer 按风格取用。
# 与 train-melody-model 分工:那个学旋律,这个只学和声,落实「旋律与和声分开建模」。
# 来源:--abc 读 ABC 目录(如 Nottingham,和弦为引号内记号);按 K: 调号或调性识别把和弦根音归一到相对主音的音阶级序号。
# 运行: uv run --python 3.12 tools/train-chord-model.py --abc <目录> --mode <major|minor> --out <路径> [--limit N]

import argparse
import glob
import json
import os
import sys
import collections
from music21 import converter, harmony, key as m21key

DURS = [0.25, 0.5, 0.75, 1.0, 1.5, 2.0, 3.0, 4.0]
def quantize(q):
    return min(DURS, key=lambda d: abs(d - q))

SCALE_PCS = {'major': [0, 2, 4, 5, 7, 9, 11], 'minor': [0, 2, 3, 5, 7, 8, 10]}

#### 把相对主音的音级(0-11)吸附到最近的音阶级,返回其序号 ####
def nearest_scale_index(pc, scale_pcs):
    best_i, best_d = 0, 99
    for i, s in enumerate(scale_pcs):
        d = min((pc - s) % 12, (s - pc) % 12)
        if d < best_d:
            best_d, best_i = d, i
    return best_i

#### 取一首乐谱的和弦序列 [(级序号, 时值)]:按调号把和弦根音归一为相对主音的音阶级,合并连续同根得真实和声节奏 ####
def chord_seq(score, scale_pcs):
    ks = score.flatten().getElementsByClass(m21key.Key)
    tonic_pc = ks[0].tonic.pitchClass if ks else score.analyze('key').tonic.pitchClass
    seq = []
    for cs in score.flatten().getElementsByClass(harmony.ChordSymbol):
        r = cs.root()
        if r is None:
            continue
        pc = (r.pitchClass - tonic_pc) % 12
        idx = nearest_scale_index(pc, scale_pcs)
        dur = quantize(float(cs.quarterLength) or 1.0)
        if seq and seq[-1][0] == idx:
            seq[-1] = (idx, seq[-1][1] + dur)
        else:
            seq.append((idx, dur))
    return seq if len(seq) >= 3 else None

#### 从若干首和弦序列建和声转移模型 ####
def build_chord_model(seqs, mode):
    chord_trans = collections.defaultdict(collections.Counter)
    chord_start = collections.Counter()
    chord_dur = collections.Counter()
    for seq in seqs:
        chord_start[seq[0][0]] += 1
        for idx, dur in seq:
            chord_dur[dur] += 1
        for i in range(1, len(seq)):
            chord_trans[seq[i - 1][0]][seq[i][0]] += 1
    return {
        "mode": mode,
        "source": "corpus",
        "chordTrans": {str(a): {str(k): v for k, v in c.items()} for a, c in chord_trans.items()},
        "chordStart": {str(k): v for k, v in chord_start.items()},
        "chordDur": {str(k): v for k, v in chord_dur.items()},
        "tunes": len(seqs),
    }

def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--abc', required=True)
    ap.add_argument('--mode', choices=['major', 'minor'], required=True)
    ap.add_argument('--out', required=True)
    ap.add_argument('--limit', type=int, default=0)
    args = ap.parse_args()
    scale_pcs = SCALE_PCS[args.mode]

    files = sorted(glob.glob(os.path.join(args.abc, '**', '*.abc'), recursive=True))
    seqs = []
    for f in files:
        try:
            parsed = converter.parse(f)
            scores = list(parsed.scores) if hasattr(parsed, 'scores') else [parsed]
            for s in scores:
                try:
                    ks = s.flatten().getElementsByClass(m21key.Key)
                    mode = ks[0].mode if ks else s.analyze('key').mode
                    if mode != args.mode:
                        continue
                    seq = chord_seq(s, scale_pcs)
                    if seq:
                        seqs.append(seq)
                        if args.limit and len(seqs) >= args.limit:
                            break
                except Exception:
                    continue
            if args.limit and len(seqs) >= args.limit:
                break
        except Exception as e:
            print(f"  跳过 {f}: {e}", file=sys.stderr)

    os.makedirs(os.path.dirname(args.out), exist_ok=True)
    with open(args.out, "w", encoding="utf-8") as fp:
        json.dump(build_chord_model(seqs, args.mode), fp, ensure_ascii=False, separators=(",", ":"))
    print(f"和声模型({args.mode}):训练 {len(seqs)} 首,写出 {args.out}({os.path.getsize(args.out)} 字节)")

main()
