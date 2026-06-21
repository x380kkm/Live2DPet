# /// script
# requires-python = ">=3.12"
# dependencies = ["numpy", "soundfile"]
# ///
# audience: internal
# accompaniment: 给一段旋律配伴奏并垫在人声下混音，纯 numpy 合成、soundfile 读写，完全离线、不依赖 FluidSynth/ffmpeg。
# 和声复用作曲输出：优先读 melody.json 里的 chords 跨度（起始拍、拍长、根音、和弦音），按跨度铺和弦垫与贝斯，与旋律同源对齐；无 chords 时退回从旋律反推。
# 鼓组不单调：逐小节在几种 groove 间切换并加切分，乐句尾（由和弦跨度间的换气空隙判定）打过门，贝斯在乐句尾走音接续。
# 输入：melody.json(含 tonicMidi、scale、tempo、melody[{key,beats}|{rest}]，可含 chords[{startBeat,beats,root,pcs}])、人声 WAV、输出路径。
# 运行： uv run --python 3.12 tools/accompaniment.py <melody.json> <vocal.wav> <out.wav>
import json
import sys
import numpy as np
import soundfile as sf

SR = 24000
SCALES = {'pentatonic': [0, 2, 4, 7, 9], 'diatonic': [0, 2, 4, 5, 7, 9, 11], 'minor': [0, 2, 3, 5, 7, 8, 10]}

def midi_to_freq(m):
    return 440.0 * 2 ** ((m - 69) / 12)

#### 合成一个带起落包络的乐音（正弦叠二次谐波，柔和） ####
def tone(freq, dur, amp, attack=0.01, release=0.08, harm=0.3):
    n = max(1, int(dur * SR))
    t = np.arange(n) / SR
    w = np.sin(2 * np.pi * freq * t) + harm * np.sin(2 * np.pi * 2 * freq * t)
    env = np.ones(n)
    a = min(int(attack * SR), n // 2)
    r = min(int(release * SR), n // 2)
    if a > 0:
        env[:a] = np.linspace(0, 1, a)
    if r > 0:
        env[-r:] = np.linspace(1, 0, r)
    return amp * w * env

#### 合成一段噪声（鼓用），带快速衰减；音色噪声用固定种子保持一致 ####
def noise(dur, amp, decay=0.5, highpass=False):
    n = max(1, int(dur * SR))
    x = np.random.default_rng(0).standard_normal(n)
    if highpass:
        x = np.diff(x, prepend=0.0)  # 粗略高通，给镲片更脆
    env = np.exp(-np.arange(n) / (decay * SR))
    return amp * x * env

#### 合成底鼓：短促下滑正弦，带敲击感 ####
def kick(amp=0.22):
    n = int(0.18 * SR)
    t = np.arange(n) / SR
    f = 120 * np.exp(-t / 0.03) + 45  # 音高快速下滑到低频
    w = np.sin(2 * np.pi * np.cumsum(f) / SR)
    env = np.exp(-t / 0.10)
    return amp * w * env

#### 合成嗵鼓（过门用）：中频下滑正弦 ####
def tom(freq, amp=0.16):
    n = int(0.16 * SR)
    t = np.arange(n) / SR
    f = freq * np.exp(-t / 0.05) + freq * 0.6
    w = np.sin(2 * np.pi * np.cumsum(f) / SR)
    env = np.exp(-t / 0.09)
    return amp * w * env

#### 把一段波形按起始秒数叠加到总缓冲 ####
def place(buf, wave, start_sec):
    s = int(start_sec * SR)
    e = min(len(buf), s + len(wave))
    if s < len(buf):
        buf[s:e] += wave[:e - s]

#### 从旋律反推每小节和弦（无 chords 时的回退）：取与该小节旋律音重合最多的调内三和弦 ####
def derive_chords(melody, tonic, scale):
    bar_beats = 4
    notes = []
    cum = 0.0
    for e in melody:
        if e.get('rest') is not None:
            cum += e['rest']
        else:
            notes.append((cum, e['key']))
            cum += e['beats']
    total_beats = cum

    def triad(deg_index):
        idx = [deg_index, deg_index + 2, deg_index + 4]
        return [scale[i % len(scale)] + 12 * (i // len(scale)) for i in idx]
    cand = [triad(i) for i in (0, 3, 4, 5)]

    chords = []
    n_bars = int(np.ceil(total_beats / bar_beats))
    for b in range(n_bars):
        b0, b1 = b * bar_beats, (b + 1) * bar_beats
        pcs = [((k - tonic) % 12) for (ob, k) in notes if b0 <= ob < b1]
        best, best_score = cand[0], -1
        for c in cand:
            cpc = set(x % 12 for x in c)
            score = sum(1 for p in pcs if p in cpc)
            if score > best_score:
                best_score, best = score, c
        chords.append({'startBeat': b0, 'beats': bar_beats, 'root': best[0] % 12, 'pcs': [x % 12 for x in best]})
    return chords

#### 几种一小节鼓 groove：底鼓、军鼓、闭镲的拍位（拍数 0..4），逐小节切换避免单调 ####
GROOVES = [
    {'kick': [0, 2], 'snare': [1, 3], 'hat': [0, 0.5, 1, 1.5, 2, 2.5, 3, 3.5]},          # 基本八分镲
    {'kick': [0, 2, 2.5], 'snare': [1, 3], 'hat': [0, 0.5, 1, 1.5, 2, 2.5, 3, 3.5]},     # 第三拍后切分底鼓
    {'kick': [0, 1.5, 2], 'snare': [1, 3], 'hat': [0, 0.5, 1, 1.5, 2, 2.5, 3, 3.5]},     # 第二拍弱位切分
    {'kick': [0, 1, 2, 3], 'snare': [1, 3], 'hat': [0, 1, 2, 3]},                        # 推进式四分底鼓
    {'kick': [0, 2], 'snare': [1, 3], 'hat': [0, 1, 2, 3]},                              # 收一收的四分镲
]

#### 给一个小节铺鼓：按 groove 放底鼓/军鼓/闭镲，乐句尾用过门替掉第 4 拍 ####
def drum_bar(buf, bar_start_sec, spb, groove, fill, open_hat):
    for t in groove['kick']:
        place(buf, kick(0.22), bar_start_sec + t * spb)
    for t in groove['snare']:
        if fill and t >= 3:
            continue  # 过门接管第 4 拍的军鼓
        place(buf, noise(0.16, 0.11, decay=0.12), bar_start_sec + t * spb)
    for i, t in enumerate(groove['hat']):
        if fill and t >= 3:
            continue
        amp = 0.045 if (abs(t - round(t)) < 1e-6) else 0.028  # 正拍重、弱位轻
        place(buf, noise(0.05, amp, decay=0.03, highpass=True), bar_start_sec + t * spb)
    if open_hat:
        place(buf, noise(0.12, 0.05, decay=0.08, highpass=True), bar_start_sec + 3.5 * spb)  # 句中开镲点缀
    if fill:
        # 第 4 拍嗵鼓下行十六分过门，收向下一句
        for j, f in enumerate((200, 170, 140, 110)):
            place(buf, tom(f, 0.16), bar_start_sec + (3 + j * 0.25) * spb)

def main():
    data = json.load(open(sys.argv[1], encoding='utf-8'))
    vocal_path, out_path = sys.argv[2], sys.argv[3]
    tonic = data['tonicMidi']
    scale = SCALES.get(data.get('scale', 'diatonic'), SCALES['diatonic'])
    tempo = data.get('tempo', 100)
    spb = 60.0 / tempo  # 每拍秒数

    chords = data.get('chords') or derive_chords(data['melody'], tonic, scale)
    end_beat = max(c['startBeat'] + c['beats'] for c in chords)
    total_sec = end_beat * spb + 0.6
    buf = np.zeros(int(total_sec * SR))

    # 每首歌一个稳定但不同的随机源，用来逐小节挑 groove 与点缀，既有变化又可复现。
    seed = 20240620 + len(chords) + int(round(sum(c['root'] for c in chords)))
    rng = np.random.default_rng(seed)

    n = len(chords)
    for i, c in enumerate(chords):
        start = c['startBeat'] * spb
        # 乐句尾：本小节末与下一小节始之间有换气空隙，或为全曲末小节。
        gap = (i == n - 1) or (chords[i + 1]['startBeat'] > c['startBeat'] + c['beats'] + 1e-6)
        # 和弦垫：三个和弦音放在主音下方一带的中音区，整小节柔和持续。
        for pc in c['pcs']:
            place(buf, tone(midi_to_freq(tonic + pc - 12), c['beats'] * spb, 0.05, attack=0.05, release=0.18), start)
        # 贝斯：根音低八度在第 1、3 拍拨奏；乐句尾第 3 拍走到下一句根音作接续。
        root_f = midi_to_freq(tonic + c['root'] - 24)
        place(buf, tone(root_f, spb * 0.9, 0.12, attack=0.005, release=0.05, harm=0.5), start)
        if gap and i + 1 < n:
            nxt_f = midi_to_freq(tonic + chords[i + 1]['root'] - 24)
            place(buf, tone(nxt_f, spb * 0.9, 0.11, attack=0.005, release=0.05, harm=0.5), start + 2 * spb)
        else:
            place(buf, tone(root_f, spb * 0.9, 0.11, attack=0.005, release=0.05, harm=0.5), start + 2 * spb)
        # 鼓组：逐小节换 groove，句尾打过门，偶尔开镲点缀。
        groove = GROOVES[int(rng.integers(0, len(GROOVES)))]
        open_hat = (not gap) and (rng.random() < 0.3)
        drum_bar(buf, start, spb, groove, fill=gap, open_hat=open_hat)

    # 归一伴奏到柔和水平
    if np.max(np.abs(buf)) > 0:
        buf = buf / np.max(np.abs(buf)) * 0.5

    vocal, vsr = sf.read(vocal_path)
    if vocal.ndim > 1:
        vocal = vocal.mean(axis=1)
    if vsr != SR:
        idx = np.linspace(0, len(vocal) - 1, int(len(vocal) * SR / vsr))  # 简单线性重采样到 24k
        vocal = np.interp(idx, np.arange(len(vocal)), vocal)
    L = max(len(vocal), len(buf))
    v = np.zeros(L)
    a = np.zeros(L)
    v[:len(vocal)] = vocal
    a[:len(buf)] = buf
    mix = v * 1.0 + a * 0.6  # 人声为主、伴奏垫底
    peak = np.max(np.abs(mix))
    if peak > 1.0:
        mix = mix / peak * 0.99
    sf.write(out_path, mix, SR)
    print(f"伴奏 {n} 小节，tempo {tempo}，混音时长 {L / SR:.1f}s -> {out_path}")

main()
