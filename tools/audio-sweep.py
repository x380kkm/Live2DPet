# /// script
# requires-python = ">=3.12"
# dependencies = ["praat-parselmouth", "numpy", "faster-whisper", "opencc-python-reimplemented"]
# ///
# audience: internal
# audio-sweep: 读 tts-sweep.js 写的 manifest,对每组配置同时算两项指标:
#   识别率(中文语音识别转写与目标汉字的最长公共子序列字级匹配率,衡量发音是否听得清),
#   突兀度(相邻音节中段 F0 跳变的均值与最大值、最高 F0,衡量音调是否自然不尖锐)。
# 打印按突兀度排序的对照表,挑识别率达标且突兀度最低的一组。运行:uv run --python 3.12 tools/audio-sweep.py
import json
import os
import re
import numpy as np
import parselmouth
from faster_whisper import WhisperModel
from opencc import OpenCC

T2S = OpenCC("t2s")


def lcs(a, b):
    dp = [[0] * (len(b) + 1) for _ in range(len(a) + 1)]
    for i in range(1, len(a) + 1):
        for j in range(1, len(b) + 1):
            dp[i][j] = dp[i - 1][j - 1] + 1 if a[i - 1] == b[j - 1] else max(dp[i - 1][j], dp[i][j - 1])
    return dp[len(a)][len(b)]


def hanzi_only(text):
    return re.sub(r"[^一-鿿]", "", text)


def syl_f0(f0t, f0, s):
    # 取音节中段 60%(避开交界与辅音段污染)的有声 F0 中位数,作该字代表音高
    c0 = s["start"] + 0.2 * (s["end"] - s["start"])
    c1 = s["end"] - 0.2 * (s["end"] - s["start"])
    m = (f0t >= c0) & (f0t < c1)
    v = f0[m]
    v = v[v > 0]
    return float(np.median(v)) if len(v) else 0.0


def voiced_frac(f0t, f0, s):
    m = (f0t >= s["start"]) & (f0t < s["end"])
    return float(np.mean(f0[m] > 0)) if np.any(m) else 0.0


def main():
    base = os.path.dirname(os.path.abspath(__file__))
    sdir = os.path.join(base, "samples", "sweep")
    manifest = json.load(open(os.path.join(sdir, "manifest.json"), encoding="utf-8"))
    model = WhisperModel("small", device="cpu", compute_type="int8")

    rows = []
    for item in manifest:
        snd = parselmouth.Sound(item["wav"])
        pitch = snd.to_pitch(time_step=0.005)
        f0t = pitch.xs()
        f0 = pitch.selected_array["frequency"]

        syl = item["syllables"]
        meds = [syl_f0(f0t, f0, s) for s in syl]
        fracs = [voiced_frac(f0t, f0, s) for s in syl]
        lost = sum(1 for fr in fracs if fr < 0.4)

        jumps = []
        for i in range(len(syl) - 1):
            a, b = meds[i], meds[i + 1]
            if a > 0 and b > 0:
                jumps.append(abs(12 * np.log2(b / a)))
        jump_mean = float(np.mean(jumps)) if jumps else 0.0
        jump_max = float(np.max(jumps)) if jumps else 0.0
        f0_voiced = f0[f0 > 0]
        f0_max = float(np.max(f0_voiced)) if len(f0_voiced) else 0.0
        f0_med = float(np.median(f0_voiced)) if len(f0_voiced) else 0.0
        peak_ratio = f0_max / f0_med if f0_med else 0.0

        segments, _ = model.transcribe(item["wav"], language="zh", beam_size=5)
        asr = hanzi_only(T2S.convert("".join(s.text for s in segments)))
        target = hanzi_only(item["hanzi"])
        rate = lcs(target, asr) / max(1, len(target))

        rows.append({
            "tag": item["tag"], "ts": item["toneStrength"], "sp": item["spread"],
            "asr": rate, "jump_mean": jump_mean, "jump_max": jump_max,
            "f0_max": f0_max, "peak_ratio": peak_ratio, "lost": lost, "asr_text": asr,
        })
        print(f"{item['tag']:<16} ASR={rate*100:5.1f}% 突兀均{jump_mean:4.1f} 最大{jump_max:4.1f} "
              f"峰F0{f0_max:5.0f} 峰/中{peak_ratio:4.2f} 丢{lost} 识别={asr}")

    # 排序:先要识别率达标(>=阈值),再按突兀度均值升序,挑自然度最好的
    THRESH = max(r["asr"] for r in rows) - 0.1
    ok = [r for r in rows if r["asr"] >= THRESH]
    ok.sort(key=lambda r: (r["jump_mean"], r["jump_max"], r["peak_ratio"]))
    print(f"\n识别率达标(>= 最高-10pt = {THRESH*100:.1f}%)中突兀度最低排序:")
    for r in ok[:6]:
        print(f"  {r['tag']:<16} ASR={r['asr']*100:5.1f}% 突兀均{r['jump_mean']:4.1f} 最大{r['jump_max']:4.1f} 峰F0{r['f0_max']:5.0f}")
    best = ok[0] if ok else min(rows, key=lambda r: r["jump_mean"])
    print(f"\n推荐:{best['tag']}  toneStrength={best['ts']} spread={best['sp']}  "
          f"ASR={best['asr']*100:.1f}% 突兀均{best['jump_mean']:.1f}")
    json.dump(rows, open(os.path.join(sdir, "metrics.json"), "w", encoding="utf-8"), ensure_ascii=False, indent=2)


if __name__ == "__main__":
    main()
