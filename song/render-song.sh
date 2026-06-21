#!/usr/bin/env bash
# audience: internal
# render-song: 跑完整条歌唱生成管线出一首哼唱混音。默认用随机种子驱动(每次不同,便于主观判断改动),并把种子打印出来可复现。
# 步骤:作曲(主声部加第二声部)与配方 → 人声哼唱 → MMA 配器 → 编排布像加第二声部与弦乐 → 装饰后处理 → 叠层 → 表情控制器 → FluidSynth 渲染 → 立体声混音(人声归一加侧链) → 压 mp3。
# 不用 set -e:某些原生步骤(VOICEVOX 合成)在本机退出码偶发非零却已正常产物,故每步改判产物文件是否生成。
# 管线脚本在 song/(随仓库受控);第三方二进制(FluidSynth、GeneralUser GS soundfont、MMA)体积大、不入库,放 gitignore 的 archive/audio-tools/;产物写进 gitignore 的 song/out/。
# 运行: bash song/render-song.sh <风格> [种子] [输出前缀]   种子省略则随机。
ROOT=/w/AIPAT/Live2DPet
cd "$ROOT" || exit 1
FS="archive/audio-tools/fluidsynth/fluidsynth-v2.5.5-win10-x64-glib/bin/fluidsynth.exe"
SF="archive/audio-tools/GeneralUser-GS.sf2"
MMA="archive/audio-tools/mma-master/mma.py"

genre="${1:-jpop-upbeat}"
seed="${2:-$(node -e 'process.stdout.write(String(Math.floor(Math.random()*1e9)))')}"
pfx="${3:-song/out/r-$genre-$seed}"

need() { if [ ! -s "$1" ]; then echo "FAILED at: $2 (缺 $1) genre=$genre seed=$seed"; exit 1; fi; }

node song/sing-prep.js "$genre" "$seed" "$pfx" >/dev/null 2>&1; need "$pfx.lead.json" sing-prep
node song/hum-render.js "$pfx.singable.json" "$pfx.meta.json" "$pfx" >/dev/null 2>&1; need "$pfx.vocal.wav" hum-render
uv run --python 3.12 "$MMA" "$pfx.chart.mma" -f "$pfx.raw.mid" >/dev/null 2>&1; need "$pfx.raw.mid" mma
uv run --python 3.12 song/arrange-midi.py "$pfx.raw.mid" "$pfx.lead.json" "$pfx.chords.json" "$pfx.arrange.json" "$pfx.arr.mid" >/dev/null 2>&1; need "$pfx.arr.mid" arrange
uv run --python 3.12 song/ornament.py "$pfx.arr.mid" "$pfx.orn.mid" >/dev/null 2>&1; need "$pfx.orn.mid" ornament
# 硬核电子跳过 extra-layers(它叠的暖 pad 与弦乐 stab 会变柔),只走重配的合成底色加锯齿琶音;常规风格才加额外乐器层。
if node -e "process.exit(require('./$pfx.arrange.json').drumBoost?0:1)" 2>/dev/null; then
  cp "$pfx.orn.mid" "$pfx.extra.mid"
else
  uv run --python 3.12 song/extra-layers.py "$pfx.orn.mid" "$pfx.chords.json" "$pfx.arrange.json" "$pfx.extra.mid" >/dev/null 2>&1
fi
need "$pfx.extra.mid" extra-layers
uv run --python 3.12 song/expression.py "$pfx.extra.mid" "$pfx.backing.mid" >/dev/null 2>&1; need "$pfx.backing.mid" expression
"$FS" -ni -F "$pfx.backing.wav" -r 44100 -g 0.85 "$SF" "$pfx.backing.mid" >/dev/null 2>&1; need "$pfx.backing.wav" fluidsynth
uv run --python 3.12 song/band-mix.py "$pfx.vocal.wav" "$pfx.backing.wav" "$pfx.meta.json" "$pfx.final.wav" >/dev/null 2>&1; need "$pfx.final.wav" band-mix
uv run --python 3.12 song/compress-audio.py "$pfx.final.wav" >/dev/null 2>&1; need "$pfx.final.mp3" compress
echo "RENDERED genre=$genre seed=$seed 调度=$(node -e "const a=require('./$pfx.arrange.json');console.log('lead'+a.leadProgram+' counter-'+a.counterMode+' strings-'+a.strings)") -> $pfx.final.mp3"
