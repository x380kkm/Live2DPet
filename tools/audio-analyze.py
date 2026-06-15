# /// script
# requires-python = ">=3.12"
# dependencies = ["praat-parselmouth", "numpy", "matplotlib"]
# ///
# audience: internal
# audio-analyze: 读 tts-analyze-synth.js 导出的 WAV 与逐音节边界,提取真实基频 F0 与强度包络,
# 渲染语谱图 + F0 + 强度三联图(标注音节边界与拼音),并打印逐音节音高、强度、字间音高跳变,供据实际输出音频迭代。
# 运行:uv run --python 3.12 tools/audio-analyze.py
import json
import os
import numpy as np
import matplotlib
matplotlib.use("Agg")
import matplotlib.pyplot as plt
import parselmouth


def seg_stat(times, values, t0, t1, voiced_only=True):
    m = (times >= t0) & (times < t1)
    v = values[m]
    if voiced_only:
        v = v[v > 0]
    return v


def main():
    base = os.path.dirname(os.path.abspath(__file__))
    adir = os.path.join(base, "samples", "analyze")
    meta = json.load(open(os.path.join(adir, "std.json"), encoding="utf-8"))
    snd = parselmouth.Sound(meta["wav"])

    pitch = snd.to_pitch(time_step=0.005)
    f0t = pitch.xs()
    f0 = pitch.selected_array["frequency"]  # 0 = 无声
    inten = snd.to_intensity(time_step=0.005)
    it = inten.xs()
    iv = inten.values[0]
    spec = snd.to_spectrogram(window_length=0.01, maximum_frequency=5000)

    syl = meta["syllables"]

    # 映射校验:从音频实测静音段,与计算出的停顿/句首尾静音比对,确认逐字边界没错位。
    floor_db = float(np.nanmax(iv)) - 30
    sil = iv < floor_db
    regions = []
    i = 0
    while i < len(sil):
        if sil[i]:
            j = i
            while j < len(sil) and sil[j]:
                j += 1
            if it[j - 1] - it[i] >= 0.05:
                regions.append((float(it[i]), float(it[j - 1])))
            i = j
        else:
            i += 1
    print("实测静音段(s):", [f"{a:.2f}-{b:.2f}" for a, b in regions])
    print("计算停顿段(s):", [f"{a:.2f}-{b:.2f}" for a, b in meta["pauses"]],
          f"  句首前≈{0:.2f}-{syl[0]['start']:.2f} 句尾后≈{syl[-1]['end']:.2f}-{meta['total']:.2f}")

    # 逐音节统计:中段 F0(避开交界污染)、有声占比、峰值强度;有声占比低或峰值远低于中位=该字可能丢音。
    print(f"\n{'字':<7}{'调':<4}{'起止s':<14}{'F0中Hz':<9}{'有声%':<7}{'峰dB':<7}")
    f0_mid = []
    inten_peak = []
    for s in syl:
        c0 = s["start"] + 0.2 * (s["end"] - s["start"])
        c1 = s["end"] - 0.2 * (s["end"] - s["start"])
        fv = seg_stat(f0t, f0, c0, c1)
        allf = (f0t >= s["start"]) & (f0t < s["end"])
        voiced_frac = float(np.mean(f0[allf] > 0)) if np.any(allf) else 0.0
        ivv = seg_stat(it, iv, s["start"], s["end"], voiced_only=False)
        fm = float(np.median(fv)) if len(fv) else 0.0
        ip = float(np.max(ivv)) if len(ivv) else 0.0
        f0_mid.append(fm)
        inten_peak.append(ip)
        lost = "  <== 可能丢音" if voiced_frac < 0.4 or ip < float(np.nanmax(iv)) - 14 else ""
        print(f"{s['label']:<8}{s['tone']:<4}{s['start']:.2f}-{s['end']:.2f}    {fm:<9.1f}{voiced_frac*100:<7.0f}{ip:<7.1f}{lost}")
    f0_start = f0_mid
    f0_end = f0_mid
    inten_mean = inten_peak

    # 字间音高跳变(前字尾 F0 → 后字头 F0),用半音衡量更贴感知
    print("\n字间音高跳变(半音,正=上跳):")
    for i in range(len(syl) - 1):
        a, b = f0_end[i], f0_start[i + 1]
        if a > 0 and b > 0:
            semi = 12 * np.log2(b / a)
            flag = "  <== 跳变大" if abs(semi) >= 4 else ""
            print(f"  {syl[i]['label']}->{syl[i+1]['label']}: {semi:+.1f}{flag}")

    # 强度偏弱的字(比中位低 6 dB 以上)
    med = float(np.median([x for x in inten_mean if x > 0]))
    weak = [(syl[i]["label"], inten_mean[i]) for i in range(len(syl)) if 0 < inten_mean[i] < med - 6]
    print(f"\n强度中位={med:.1f}dB;偏弱的字(低于中位 6dB):{weak if weak else '无'}")

    # 三联图:波形、语谱图+F0、强度;标注音节边界与拼音
    fig, axes = plt.subplots(3, 1, figsize=(16, 9), sharex=True)
    x = np.arange(len(snd.values[0])) / snd.sampling_frequency
    axes[0].plot(x, snd.values[0], lw=0.4, color="#444")
    axes[0].set_ylabel("waveform")
    sg = 10 * np.log10(spec.values + 1e-12)
    axes[1].imshow(sg, origin="lower", aspect="auto",
                   extent=[spec.xmin, spec.xmax, spec.ymin, spec.ymax], cmap="magma", vmin=sg.max() - 70, vmax=sg.max())
    axes[1].set_ylabel("freq Hz (+F0)")
    ax1b = axes[1].twinx()
    ax1b.plot(f0t, np.where(f0 > 0, f0, np.nan), color="cyan", lw=1.6)
    ax1b.set_ylim(100, 350)
    ax1b.set_ylabel("F0 Hz")
    axes[2].plot(it, iv, color="#0a0", lw=1.2)
    axes[2].set_ylabel("intensity dB")
    axes[2].set_xlabel("time s")
    for ax in axes:
        for s in syl:
            ax.axvline(s["start"], color="w" if ax is axes[1] else "#bbb", lw=0.5, alpha=0.6)
        for p in meta["pauses"]:
            ax.axvspan(p[0], p[1], color="yellow", alpha=0.15)
    for s in syl:
        axes[0].text((s["start"] + s["end"]) / 2, 0.8 * axes[0].get_ylim()[1], s["label"],
                     ha="center", va="top", fontsize=8, color="#c00")
    out = os.path.join(adir, "std.png")
    fig.tight_layout()
    fig.savefig(out, dpi=110)
    print(f"\n已渲染 {out}")


if __name__ == "__main__":
    main()
