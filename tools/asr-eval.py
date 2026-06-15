# /// script
# requires-python = ">=3.12"
# dependencies = ["faster-whisper", "opencc-python-reimplemented"]
# ///
# audience: internal
# asr-eval: 读 asr-eval.js 写的 manifest,用中文语音识别转写每句,与目标汉字比对打分。
# 字级匹配率用最长公共子序列长度除以目标长度,粗估识别正确率,供自迭代凑音素表参考。
# 运行:uv run --python 3.12 tools/asr-eval.py
import json
import os
import re
from faster_whisper import WhisperModel
from opencc import OpenCC

T2S = OpenCC('t2s')


def lcs(a, b):
    dp = [[0] * (len(b) + 1) for _ in range(len(a) + 1)]
    for i in range(1, len(a) + 1):
        for j in range(1, len(b) + 1):
            dp[i][j] = dp[i - 1][j - 1] + 1 if a[i - 1] == b[j - 1] else max(dp[i - 1][j], dp[i][j - 1])
    return dp[len(a)][len(b)]


def hanzi_only(text):
    return re.sub(r'[^一-鿿]', '', text)


def main():
    base = os.path.dirname(os.path.abspath(__file__))
    manifest_path = os.path.join(base, 'samples', 'eval', 'manifest.json')
    manifest = json.load(open(manifest_path, encoding='utf-8'))
    model = WhisperModel('small', device='cpu', compute_type='int8')

    total_match = 0
    total_len = 0
    for item in manifest:
        segments, _ = model.transcribe(item['wav'], language='zh', beam_size=5)
        asr = hanzi_only(T2S.convert(''.join(s.text for s in segments)))
        target = hanzi_only(item['hanzi'])
        match = lcs(target, asr)
        rate = match / max(1, len(target))
        total_match += match
        total_len += len(target)
        print(f"[{item['id']}] {rate*100:5.1f}%  目标={target}  识别={asr}")
    print(f"\n总字级匹配率:{total_match}/{total_len} = {total_match/max(1,total_len)*100:.1f}%")


if __name__ == '__main__':
    main()
