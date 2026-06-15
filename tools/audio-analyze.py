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
    # 逐音节统计
    print(f"{'字':<7}{'调':<4}{'起止s':<14}{'F0均Hz':<9}{'F0尾Hz':<9}{'强度dB':<8}")
    f0_end = []
    f0_start = []
    inten_mean = []
    for s in syl:
        fv = seg_stat(f0t, f0, s["start"], s["end"])
        ivv = seg_stat(it, iv, s["start"], s["end"], voiced_only=False)
        fm = float(np.mean(fv)) if len(fv) else 0.0
        fe = float(np.mean(fv[-3:])) if len(fv) >= 3 else (float(fv[-1]) if len(fv) else 0.0)
        fs = float(np.mean(fv[:3])) if len(fv) >= 3 else (float(fv[0]) if len(fv) else 0.0)
        im = float(np.mean(ivv)) if len(ivv) else 0.0
        f0_end.append(fe)
        f0_start.append(fs)
        inten_mean.append(im)
        print(f"{s['label']:<8}{s['tone']:<4}{s['start']:.2f}-{s['end']:.2f}    {fm:<9.1f}{fe:<9.1f}{im:<8.1f}")

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
