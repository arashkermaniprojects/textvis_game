# TextVis

TextVis turns a research paper (PDF) into a 3D knowledge-graph lecture. A
local LLM extracts subject–verb–object triples and a narration from the
paper, the triples are laid out as a clustered 3D graph, and the narration
is synthesised with Kokoro TTS. Everything the renderers need is stored in
one file per lecture, `lectures/<id>/world_state.json`, which drives both

- a **narrated lecture video** (Godot, rendered offline to MP4), and
- an **interactive Godot scene** (free-flight camera, click a node or edge
  to inspect it and hear its narration, replay the lecture on demand).

The repository contains the full pipeline code and the extracted data for
15 lectures (`lectures/*/{graph_data,lecture_state,world_state}.json`).
Generated media (audio, images, icons, videos) and the source PDFs are not
included.

## Repository layout

```
agents/     PDF → scenes → narration → triples (article-watcher-v2.mjs), Louvain clustering, TTS agents
llm/        OpenAI-compatible client (local vLLM or OpenAI API)
visual/     triple extraction / visual command compiler used by the watcher
pipeline/   watcher HTML → graph_data.json, formula PNG cards, SVG → PNG icons
tools/      orchestration, post-processing, layout, rendering, metrics
godot/      Godot 4.3 project (world loader, lecture mode, interaction)
lectures/   15 lectures (JSON only)
results/    metric outputs (see results/README.md)
source_papers/SOURCES.md   bibliographic list of the 15 source papers
docs/blender_animated.py.reference   legacy Blender renderer the layout/camera code was ported from (not executed)
```

## Requirements

- **Node.js ≥ 18** (`npm install` installs the `openai` client)
- **Python 3.12** in a virtual environment at `<repo>/.venv-kokoro`
  (the tools call `.venv-kokoro/bin/python` directly):
  ```bash
  python3.12 -m venv .venv-kokoro
  .venv-kokoro/bin/pip install -r requirements.txt
  ```
  `cairosvg` additionally needs the system Cairo library.
- **Kokoro model files** in `<repo>/.kokoro-models/`:
  ```bash
  mkdir -p .kokoro-models && cd .kokoro-models
  curl -LO https://github.com/thewh1teagle/kokoro-onnx/releases/download/model-files-v1.0/kokoro-v1.0.onnx
  curl -LO https://github.com/thewh1teagle/kokoro-onnx/releases/download/model-files-v1.0/voices-v1.0.bin
  ```
- **poppler-utils** (`pdftotext`, `pdfinfo`, `pdfimages`, `pdftoppm`)
- **FFmpeg** on `PATH`
- **Godot 4.3** on `PATH` (or at `~/.local/bin/godot`)
- **vLLM** serving two OpenAI-compatible endpoints (8192-token context):
  ```bash
  # text LLM on :8000
  vllm serve Qwen/Qwen2.5-14B-Instruct-AWQ --port 8000 \
      --max-model-len 8192 --gpu-memory-utilization 0.45
  # vision-language model on :8001 (only for inspect-images-vl.mjs)
  vllm serve Qwen/Qwen2.5-VL-7B-Instruct-AWQ --port 8001 \
      --max-model-len 8192 --gpu-memory-utilization 0.45
  ```
  Adjust `--gpu-memory-utilization` to your GPU. The endpoints can be
  overridden with `TEXTVIS_LOCAL_TEXT_URL` / `TEXTVIS_LOCAL_TEXT_MODEL` and
  `TEXTVIS_LOCAL_VL_URL` / `TEXTVIS_LOCAL_VL_MODEL`.

## Pipeline

Put the PDF in `source_papers/` (see `source_papers/SOURCES.md` for the
papers used here). Intermediate files are written to a working directory
`/tmp/textvis_run_<id>/`; the finished lecture is copied to `lectures/<id>/`.

```bash
# 1. PDF → triples + narration + TTS → lectures/<id>/
#    (article-watcher-v2 → render-formula-pngs → watcher-to-blender-data
#     → post-process-narration)
node tools/ingest-paper.mjs --pdf source_papers/<id>.pdf --basename <id> [--title "Paper title"]

# 2. Optional refinement steps
node tools/fetch-wiki-simple.mjs <id> --max 2      # Wikipedia images per node
node tools/inspect-images-vl.mjs <id>              # VLM relevance gate (threshold 0.55)
node tools/clean-subtitles.mjs <id>                # LLM narration clean-up
node tools/regen-from-state.mjs <id>               # re-synthesise only changed clips
node tools/sync-from-workdir.mjs <id>              # copy regenerated audio back to lectures/<id>/
node tools/rebuild-overlay-timeline.mjs <id>       # bind images/formulas to edges

# 3. Layout → world_state.json
node tools/compute-layout.mjs lectures/<id>

# 4. Render the lecture video (Godot --write-movie → FFmpeg H.264/AAC)
node tools/render-lecture.mjs --lecture <id> --output out/<id>.mp4
```

`node tools/rebuild-lecture.mjs <id>` runs clean-subtitles, regen-from-state,
the sync and compute-layout in one go. `regen-from-state.mjs` stores a hash
of each clip's text, voice, speed and language in
`audio_clips/regen_hashes.json`, so editing one subtitle regenerates one clip.
Voices and camera constants are configured in `tools/pipeline-config.json`.

The committed lectures contain no audio. To synthesise it for an existing
lecture:

```bash
mkdir -p /tmp/textvis_run_<id>/audio_clips
cp lectures/<id>/graph_data.json lectures/<id>/lecture_state.json /tmp/textvis_run_<id>/
node tools/regen-from-state.mjs <id> && node tools/sync-from-workdir.mjs <id>
```

## Interactive mode

```bash
godot --path godot -- --lecture <id>
```

WASD/Q/E to fly, Shift to sprint, mouse to look, left click to inspect the
node or edge under the crosshair (edges play their narration clip), Space to
start/stop the scripted lecture, Esc to release the mouse. Other flags:
`--auto-lecture`, `--screenshot <png>`, `--preview [--preview-dir <dir>]`.

`node tools/lecture-server.mjs` (port 7777) exposes the lectures over HTTP
and supports asking questions via the local LLM and injecting nodes/edges
into a `world_state.json` (`tools/mutate-world.mjs`).

## Reproducing the results

```bash
node tools/metric-noun-repetition.mjs --all --json results/noun_repetition.json
node tools/metric-label-proximity.mjs --all --json results/label_proximity.json
```

Both scripts read only the committed lecture JSON. See `results/README.md`
for the aggregate numbers and `results/rescale_factors.json`.
`tools/metric-image-grounding.mjs` additionally needs the generated overlay
images and the VLM server.

## Blender renderer

`tools/render-from-world.py` is a partial reference renderer for Blender:
it reads `world_state.json` and the camera constants, but draws straight
edges, has no overlays or audio, and by default renders a single still.

```bash
blender -b --factory-startup -P tools/render-from-world.py -- --lecture <id> --output out/<id>.png
```

The Godot renderer is the primary renderer.

## Licence

Code: MIT (see `LICENSE`). The source papers belong to their respective
copyright holders and are not redistributed.

## AI assistance

Parts of the code and documentation were developed with the assistance of
AI coding tools; all content was reviewed by the authors.
