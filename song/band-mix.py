# /// script
# requires-python = ">=3.12"
# dependencies = ["numpy", "soundfile"]
# ///
# audience: internal
# band-mix(scratch):把 FluidSynth 渲染的立体声乐队垫到 VOICEVOX 人声下混音,保留声场(伴奏立体声不塌成单声道),人声居中靠前、清晰不被压。
# 人声先做峰值归一保证音量一致,再用侧链压伴奏(人声响处把伴奏拉低、人声停处放回),使人声始终浮在乐队之上;伴奏后移对齐下拍;人声加短混响黏合,输出立体声。
# 运行: uv run --python 3.12 archive/band-mix.py <vocal.wav> <backing.wav> <meta.json> <out.wav>
import json
import sys
import numpy as np
import soundfile as sf

SR = 44100

#### 读成单声道(人声用) ####
def read_mono(path):
    x, sr = sf.read(path)
    if x.ndim > 1:
        x = x.mean(axis=1)
    if sr != SR:
        idx = np.linspace(0, len(x) - 1, int(len(x) * SR / sr))
        x = np.interp(idx, np.arange(len(x)), x)
    return x

#### 读成立体声 [n,2](伴奏用,保留声场) ####
def read_stereo(path):
    x, sr = sf.read(path)
    if x.ndim == 1:
        x = np.stack([x, x], axis=1)
    if sr != SR:
        idx = np.linspace(0, len(x) - 1, int(len(x) * SR / sr))
        x = np.stack([np.interp(idx, np.arange(len(x)), x[:, 0]), np.interp(idx, np.arange(len(x)), x[:, 1])], axis=1)
    return x

#### 滑动平均(累加和实现,O(n)),给信号取一条平滑包络 ####
def movavg(x, w):
    if w < 2:
        return np.abs(x)
    c = np.cumsum(np.insert(np.abs(x), 0, 0.0))
    out = (c[w:] - c[:-w]) / w
    pad = w - 1
    return np.concatenate([np.full(pad - pad // 2, out[0]), out, np.full(pad // 2, out[-1])])[:len(x)]

#### 侧链压低:按人声包络把伴奏增益拉低(人声越响伴奏越低),停唱处放回满音量,使人声始终清晰浮在乐队上 ####
# depth 最大压低比例(0.55 即人声最响处伴奏降到 45%);也给硬核电子带来随人声起伏的泵动感。
def sidechain_gain(vocal, depth=0.55, win_ms=70):
    env = movavg(vocal, int(win_ms * SR / 1000))
    env = env / (env.max() + 1e-9)
    return 1.0 - depth * env  # 长度与 vocal 同;伴奏逐样本乘此增益

#### 极简反馈混响:给单声道信号加一串衰减回声,做空间黏合 ####
def reverb(x, amount=0.18):
    out = x.copy()
    for delay_ms, g in ((37, 0.5), (61, 0.4), (89, 0.3), (130, 0.22)):
        d = int(delay_ms * SR / 1000)
        if d < len(out):
            out[d:] += x[:-d] * g
    return x * (1 - amount) + out * amount * 0.6

def main():
    vocal_path, backing_path, meta_path, out_path = sys.argv[1:5]
    meta = json.load(open(meta_path, encoding='utf-8'))
    spb = 60.0 / meta['tempo']
    lead = meta.get('leadRestBeats', 0.25) * spb  # 人声引导休止秒数,伴奏后移这么多以对齐下拍

    vocal = read_mono(vocal_path)
    backing = read_stereo(backing_path)
    song_sec = meta.get('bars', 8) * 4 * spb
    backing = backing[:int((song_sec + 1.5) * SR)]  # 裁掉过长的混响尾,留 1.5 秒自然衰减
    off = int(lead * SR)
    L = max(len(vocal), off + len(backing))

    # 人声峰值归一:抹平 VOICEVOX 各曲输出电平差异,保证人声始终到位、不会某些曲偏小被压。
    vpk = np.max(np.abs(vocal))
    if vpk > 1e-6:
        vocal = vocal / vpk * 0.97
    voc = np.zeros(L)
    voc[:len(vocal)] = vocal
    duck = sidechain_gain(voc)  # 先按干净人声算侧链增益,再给人声加混响
    voc = reverb(voc, amount=0.16)  # 人声加一点空间感,与乐队黏合
    bak = np.zeros((L, 2))
    bak[off:off + len(backing)] = backing
    bak[:, 0] *= duck  # 侧链:伴奏在人声响处被压低,停唱处放回,人声始终浮在乐队上
    bak[:, 1] *= duck

    mix = np.zeros((L, 2))
    # 人声更靠前(1.0),伴奏底座降到 0.5 再叠侧链;比例与侧链共同保证人声清晰不被配器压制。
    mix[:, 0] = voc * 1.0 + bak[:, 0] * 0.5
    mix[:, 1] = voc * 1.0 + bak[:, 1] * 0.5
    peak = np.max(np.abs(mix))
    if peak > 1.0:
        mix = mix / peak * 0.99
    sf.write(out_path, mix, SR)
    print(f"立体声混音 {L / SR:.1f}s,伴奏后移 {lead * 1000:.0f}ms,人声归一加侧链压低伴奏 -> {out_path}")

main()
