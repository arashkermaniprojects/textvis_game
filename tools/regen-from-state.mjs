#!/usr/bin/env node
/**
 * regen-from-state.mjs <basename>
 *
 * Reads /tmp/textvis_run_<basename>/lecture_state.json (the editable source
 * of truth) and rebuilds the audio + graph_data + durations to match.
 *
 * Use this when you want to:
 *   - Edit a single subtitle by hand → re-run only that audio clip
 *   - Change the voice for the whole lecture → all clips regenerate
 *   - Reorder/remove edges → audio re-aligned to the new sequence
 *   - Tweak the sentence gap → only durations change (no TTS needed)
 *
 * After running this, re-run the render.
 *
 * The lecture_state.json schema:
 *   {
 *     basename, generated_at,
 *     voice: { name, speed, lang },
 *     audio: { sentence_gap_seconds },
 *     edges: [
 *       { index, from, from_label, to, to_label, verb,
 *         subtitle, audio_clip, audio_start, audio_duration,
 *         image: { png, caption, kind } | null }
 *     ]
 *   }
 */
import { readFileSync, writeFileSync, existsSync, statSync, unlinkSync } from 'fs';
import { execSync, spawnSync } from 'child_process';
import { createHash } from 'crypto';
import { fileURLToPath } from 'url';
import { dirname } from 'path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const PROJECT = dirname(__dirname);

const basename = process.argv[2];
if (!basename) {
  console.error('usage: regen-from-state.mjs <basename>');
  process.exit(2);
}

const WORK = `/tmp/textvis_run_${basename}`;
const statePath = `${WORK}/lecture_state.json`;
const graphPath = `${WORK}/graph_data.json`;
const durationsPath = `${WORK}/audio_clips/durations.json`;
const audioDir = `${WORK}/audio_clips`;
const hashesPath = `${audioDir}/regen_hashes.json`;

if (!existsSync(statePath)) {
  console.error(`No lecture_state.json — run post-process-narration.mjs first.`);
  process.exit(2);
}

const state = JSON.parse(readFileSync(statePath, 'utf-8'));
const graph = JSON.parse(readFileSync(graphPath, 'utf-8'));

// Determine which audio clips need regeneration:
// Each clip's sha1(subtitle|voice|speed|lang) is stored in
// audio_clips/regen_hashes.json. If the clip is missing, or its stored hash
// differs from the current one, regenerate. Clips with no stored hash (e.g.
// produced before the sidecar existed) fall back to the old mtime check.
function clipAbsPath(edge) {
  // edge.audio_clip is stored as "audio_clips/edge_NNN.wav" — already
  // contains the audio_clips/ prefix, so resolve from WORK, not audioDir.
  return `${WORK}/${edge.audio_clip}`;
}
function clipHash(edge) {
  const v = state.voice || {};
  return createHash('sha1')
    .update([edge.subtitle, v.name, v.speed, v.lang || 'en-us'].join('|'))
    .digest('hex');
}
let storedHashes = {};
try { storedHashes = JSON.parse(readFileSync(hashesPath, 'utf-8')); } catch {}
function needsRegeneration(edge) {
  const clipPath = clipAbsPath(edge);
  if (!existsSync(clipPath)) return true;
  const stored = storedHashes[edge.audio_clip];
  if (stored === undefined) {
    return statSync(statePath).mtimeMs > statSync(clipPath).mtimeMs;
  }
  return stored !== clipHash(edge);
}

const toRegen = state.edges.filter(needsRegeneration);
const failedIdx = new Set();
console.log(`[regen-from-state] ${toRegen.length} of ${state.edges.length} clips need regeneration`);

if (toRegen.length > 0) {
  const pyScript = `
import sys, json
sys.path.insert(0, '${PROJECT}/.venv-kokoro/lib/python3.12/site-packages')
from kokoro_onnx import Kokoro
import soundfile as sf
import numpy as np

k = Kokoro('${PROJECT}/.kokoro-models/kokoro-v1.0.onnx', '${PROJECT}/.kokoro-models/voices-v1.0.bin')
voice = ${JSON.stringify(state.voice.name)}
speed = ${state.voice.speed}
lang = ${JSON.stringify(state.voice.lang || 'en-us')}
gap = ${state.audio.sentence_gap_seconds || 0.4}

requests = json.load(sys.stdin)
for req in requests:
    idx = req['idx']
    text = req['text']
    out = req['path']
    try:
        samples, rate = k.create(text, voice=voice, speed=speed, lang=lang)
        silence = np.zeros(int(rate * gap), dtype=samples.dtype)
        padded = np.concatenate([samples, silence])
        sf.write(out, padded, rate, format='WAV', subtype='PCM_16')
        print(f'{idx} {len(padded)/float(rate)}', flush=True)
    except Exception as e:
        print(f'{idx} ERROR {e}', flush=True)
`;
  const requests = toRegen.map(e => ({
    idx: e.index,
    text: e.subtitle,
    path: clipAbsPath(e),
  }));
  const ttsResult = spawnSync(
    `${PROJECT}/.venv-kokoro/bin/python`,
    ['-c', pyScript],
    { input: JSON.stringify(requests), encoding: 'utf-8', maxBuffer: 128 * 1024 * 1024 }
  );
  if (ttsResult.status !== 0) {
    console.error(`TTS failed: ${ttsResult.stderr?.substring(0, 500)}`);
    process.exit(1);
  }
  let okCount = 0;
  let errCount = 0;
  for (const line of (ttsResult.stdout || '').split('\n')) {
    if (!line.trim()) continue;
    const parts = line.trim().split(' ');
    const idx = parseInt(parts[0], 10);
    if (parts[1] === 'ERROR') {
      errCount++;
      failedIdx.add(idx);
      console.error(`  edge ${idx}: ${parts.slice(2).join(' ')}`);
      continue;
    }
    const dur = parseFloat(parts[1]);
    const e = state.edges.find(e => e.index === idx);
    if (e && isFinite(dur)) {
      e.audio_duration = dur;
      okCount++;
    }
  }
  console.log(`[regen-from-state] TTS: ${okCount} ok, ${errCount} errors`);
  if (errCount > 0 && okCount === 0) {
    console.error('[regen-from-state] every TTS call failed — aborting');
    process.exit(1);
  }
}

// Recompute cumulative starts in case durations changed
let cum = 0;
for (const e of state.edges) {
  e.audio_start = cum;
  cum += e.audio_duration;
}
state.audio.total_duration = cum;
writeFileSync(statePath, JSON.stringify(state, null, 2));

// Also update graph_data.json subtitles + durations.json from the state
graph.edges = state.edges.map(e => ({ from: e.from, to: e.to, verb: e.verb }));
graph.subtitles = state.edges.map(e => e.subtitle);
writeFileSync(graphPath, JSON.stringify(graph, null, 2));

const durations = state.edges.map(e => ({
  clip: e.audio_clip.replace('audio_clips/', ''),
  start: e.audio_start,
  duration: e.audio_duration,
}));
writeFileSync(durationsPath, JSON.stringify(durations, null, 2));

// Record per-clip hashes so the next run regenerates only changed clips.
const newHashes = {};
for (const e of state.edges) {
  if (!failedIdx.has(e.index) && existsSync(clipAbsPath(e))) newHashes[e.audio_clip] = clipHash(e);
}
writeFileSync(hashesPath, JSON.stringify(newHashes, null, 2));

// Rebuild narration.wav
const edgeWavs = durations.map(d => `${audioDir}/${d.clip}`).filter(existsSync);
if (edgeWavs.length > 0) {
  const listFile = `${audioDir}/concat_list.txt`;
  writeFileSync(listFile, edgeWavs.map(p => `file '${p}'`).join('\n'));
  const ffmpegBin = `${PROJECT}/.venv-kokoro/lib/python3.12/site-packages/imageio_ffmpeg/binaries/ffmpeg-linux-x86_64-v7.0.2`;
  try {
    execSync(`"${ffmpegBin}" -y -f concat -safe 0 -i "${listFile}" -c copy "${audioDir}/narration.wav"`, { stdio: 'pipe' });
    console.log(`[regen-from-state] narration.wav rebuilt (${edgeWavs.length} clips, ${cum.toFixed(1)}s)`);
  } catch (e) {
    console.warn(`narration concat failed: ${e.message?.substring(0, 100)}`);
  }
  try { unlinkSync(listFile); } catch {}
}

console.log(`[regen-from-state] complete. Re-run render-lecture.mjs to re-render.`);
