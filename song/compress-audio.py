# /// script
# requires-python = ">=3.12"
# dependencies = ["soundfile", "numpy"]
# ///
# audience: internal
# compress-audio: 把试听用的 WAV 转成有损压缩格式(优先 MP3、退回 OGG Vorbis),大幅减小体积便于发给用户。
# 运行: uv run --python 3.12 archive/compress-audio.py <wav 路径> [更多 wav...]
import os
import sys

import soundfile as sf


def convert(wav_path):
    data, sr = sf.read(wav_path)
    base = os.path.splitext(wav_path)[0]
    # 优先 MP3(通用),libsndfile 不支持则退回 OGG Vorbis。
    for ext, fmt, subtype in (('.mp3', 'MP3', 'MPEG_LAYER_III'), ('.ogg', 'OGG', 'VORBIS')):
        out = base + ext
        try:
            sf.write(out, data, sr, format=fmt, subtype=subtype)
            wav_kb = os.path.getsize(wav_path) / 1024
            out_kb = os.path.getsize(out) / 1024
            print(f"{os.path.basename(out)}  {wav_kb:.0f}KB -> {out_kb:.0f}KB ({out_kb / wav_kb:.0%})")
            return out
        except Exception as e:
            print(f"  {fmt} 不可用: {e}")
    return None


for p in sys.argv[1:]:
    convert(p)
