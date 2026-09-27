#!/usr/bin/env node
// lecture-server.mjs — HTTP bridge between the Godot game and the local
// vLLM + Kokoro stack. Zero dependencies (node: stdlib only).
//
// Routes:
//   GET  /api/health                               — liveness + vLLM probe
//   GET  /api/lectures                             — list basenames + titles
//   GET  /api/lectures/:basename                   — full world_state.json
//   GET  /api/lectures/:basename/audio/:edgeIdx    — stream the edge's WAV
//   POST /api/lectures/:basename/ask               — body {question}, calls vLLM
//   POST /api/lectures/:basename/inject            — body {op, args}, wraps mutate-world
//
// Env overrides:
//   PORT       default 7777
//   VLLM_URL   default http://localhost:8000/v1
//   VLLM_MODEL default Qwen/Qwen2.5-14B-Instruct-AWQ
//   LECTURES_DIR default <repo>/lectures
//
// /inject body shape:
//   {"op": "add-edge",    "args": {"from": "x", "to": "y", "verb": "...", "subtitle": "..."}}
//   {"op": "add-node",    "args": {"id": "x", "label": "...", "clusterId": "..."}}
//   {"op": "remove-edge", "args": {"index": 5}}
//   {"op": "remove-node", "args": {"id": "x"}}
//   {"op": "move-node",   "args": {"id": "x", "position": [1,2,3]}}

import http from "node:http";
import fs from "node:fs";
import fsp from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  addEdge,
  removeEdge,
  addNode,
  removeNode,
  moveNode,
} from "./mutate-world.mjs";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const REPO_ROOT = path.resolve(__dirname, "..");

const PORT = parseInt(process.env.PORT || "7777", 10);
const VLLM_URL = process.env.VLLM_URL || "http://localhost:8000/v1";
const VLLM_MODEL = process.env.VLLM_MODEL || "Qwen/Qwen2.5-14B-Instruct-AWQ";
const LECTURES_DIR = process.env.LECTURES_DIR || path.join(REPO_ROOT, "lectures");

// ─── helpers ────────────────────────────────────────────────────────────────
function json(res, status, body) {
  const text = JSON.stringify(body);
  res.writeHead(status, {
    "Content-Type": "application/json; charset=utf-8",
    "Content-Length": Buffer.byteLength(text),
    "Cache-Control": "no-store",
  });
  res.end(text);
}

function fail(res, status, message, extra = {}) {
  json(res, status, { error: message, ...extra });
}

async function readJsonBody(req, limit = 1_000_000) {
  const chunks = [];
  let len = 0;
  for await (const c of req) {
    chunks.push(c);
    len += c.length;
    if (len > limit) throw new Error("body too large");
  }
  if (len === 0) return {};
  const text = Buffer.concat(chunks).toString("utf8");
  try {
    return JSON.parse(text);
  } catch (e) {
    throw new Error("invalid JSON: " + e.message);
  }
}

function loadWorld(basename) {
  const p = path.join(LECTURES_DIR, basename, "world_state.json");
  if (!fs.existsSync(p)) return null;
  return JSON.parse(fs.readFileSync(p, "utf8"));
}

function saveWorld(basename, world) {
  world.generated_at = new Date().toISOString();
  const p = path.join(LECTURES_DIR, basename, "world_state.json");
  fs.writeFileSync(p, JSON.stringify(world, null, 2));
}

function recordQuestion(world, entry) {
  world.questions = world.questions || [];
  world.questions.push({ ...entry, at: new Date().toISOString() });
}

// ─── vLLM client ────────────────────────────────────────────────────────────
async function vllmChat(messages, { maxTokens = 400, temperature = 0.2 } = {}) {
  const body = {
    model: VLLM_MODEL,
    messages,
    max_tokens: maxTokens,
    temperature,
    stream: false,
  };
  const res = await fetch(`${VLLM_URL}/chat/completions`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(`vLLM HTTP ${res.status}: ${text.slice(0, 200)}`);
  }
  const data = await res.json();
  const content = data?.choices?.[0]?.message?.content;
  if (typeof content !== "string")
    throw new Error("vLLM response missing content");
  return content;
}

async function vllmAlive() {
  try {
    const res = await fetch(`${VLLM_URL}/models`, {
      signal: AbortSignal.timeout(1500),
    });
    return res.ok;
  } catch {
    return false;
  }
}

// ─── /ask prompt + parsing ──────────────────────────────────────────────────
function buildAskPrompt(world, question) {
  const title = world.title || world.basename;
  // Compact edge enumeration: "{idx}: {from_label} --{verb}--> {to_label} | {subtitle}"
  // Keeps the prompt under Qwen's 8192 context even for 100+ edge lectures.
  const lines = world.edges
    .filter((e) => typeof e.index === "number")
    .map(
      (e) =>
        `${e.index}: ${e.from_label || e.from} --${e.verb || "—"}--> ${
          e.to_label || e.to
        } | ${(e.subtitle || "").slice(0, 140)}`,
    )
    .join("\n");

  const nodeIds = world.nodes.map((n) => n.id).join(", ");

  const sys = `You are the question-answering subsystem for an interactive lecture titled "${title}". Respond with COMPACT JSON only — no prose, no markdown, no code fences.`;

  const user = `EXISTING SPOs (index: subject --verb--> object | narration):
${lines}

VALID NODE IDS (for CREATE case, both from_node_id and to_node_id MUST be in this list):
${nodeIds}

USER QUESTION: "${question}"

Choose ONE of:
  {"action":"match","edge_index":N}     — if an existing SPO already answers the question
  {"action":"create","from_node_id":"...","to_node_id":"...","verb":"...","subtitle":"...","source_evidence":"..."}
      — if a new SPO is needed. Subtitle 12-25 words, mentions BOTH from and to.
        source_evidence: short quote or paraphrase that supports the claim.

Return the JSON object and nothing else.`;

  return [
    { role: "system", content: sys },
    { role: "user", content: user },
  ];
}

function extractJson(text) {
  // Qwen sometimes wraps JSON in ```json fences, sometimes emits junk after
  // the closing brace. Find the first {...} balanced substring.
  const start = text.indexOf("{");
  if (start < 0) return null;
  let depth = 0;
  let inStr = false;
  let esc = false;
  for (let i = start; i < text.length; i++) {
    const ch = text[i];
    if (inStr) {
      if (esc) esc = false;
      else if (ch === "\\") esc = true;
      else if (ch === '"') inStr = false;
      continue;
    }
    if (ch === '"') {
      inStr = true;
      continue;
    }
    if (ch === "{") depth++;
    else if (ch === "}") {
      depth--;
      if (depth === 0) {
        try {
          return JSON.parse(text.slice(start, i + 1));
        } catch {
          return null;
        }
      }
    }
  }
  return null;
}

// ─── route handlers ─────────────────────────────────────────────────────────
async function handleHealth(req, res) {
  const vllm = await vllmAlive();
  json(res, 200, {
    ok: true,
    lectures_dir: LECTURES_DIR,
    vllm: { url: VLLM_URL, alive: vllm, model: VLLM_MODEL },
  });
}

async function handleListLectures(req, res) {
  let entries;
  try {
    entries = await fsp.readdir(LECTURES_DIR, { withFileTypes: true });
  } catch (e) {
    return fail(res, 500, "failed to read lectures dir: " + e.message);
  }
  const out = [];
  for (const e of entries) {
    if (!e.isDirectory()) continue;
    const world = loadWorld(e.name);
    if (!world) continue;
    out.push({
      basename: world.basename || e.name,
      title: world.title || e.name,
      node_count: (world.nodes || []).length,
      edge_count: (world.edges || []).length,
      cluster_count: (world.clusters || []).length,
      voice: world.voice?.name || null,
      total_duration: world.audio?.total_duration || null,
    });
  }
  out.sort((a, b) => a.basename.localeCompare(b.basename));
  json(res, 200, { lectures: out });
}

function handleGetLecture(req, res, basename) {
  const world = loadWorld(basename);
  if (!world) return fail(res, 404, "lecture not found: " + basename);
  json(res, 200, world);
}

function handleStreamAudio(req, res, basename, edgeIdx) {
  const world = loadWorld(basename);
  if (!world) return fail(res, 404, "lecture not found: " + basename);
  const edge = (world.edges || []).find((e) => e.index === edgeIdx);
  if (!edge) return fail(res, 404, `edge ${edgeIdx} not found`);
  const clip = edge.audio_clip;
  if (!clip) return fail(res, 404, `edge ${edgeIdx} has no audio_clip`);
  // Reject absolute paths that point outside the lecture dir (defensive).
  const lectureDir = path.join(LECTURES_DIR, basename);
  const abs = path.isAbsolute(clip) ? clip : path.join(lectureDir, clip);
  if (!abs.startsWith(lectureDir) && !abs.startsWith("/tmp/textvis_run_")) {
    return fail(res, 403, "audio path outside lecture dir: " + abs);
  }
  if (!fs.existsSync(abs)) {
    return fail(res, 404, "audio file missing on disk: " + abs);
  }
  const stat = fs.statSync(abs);
  res.writeHead(200, {
    "Content-Type": "audio/wav",
    "Content-Length": stat.size,
    "Accept-Ranges": "bytes",
    "Cache-Control": "no-store",
  });
  fs.createReadStream(abs).pipe(res);
}

async function handleAsk(req, res, basename) {
  const world = loadWorld(basename);
  if (!world) return fail(res, 404, "lecture not found: " + basename);
  let body;
  try {
    body = await readJsonBody(req);
  } catch (e) {
    return fail(res, 400, e.message);
  }
  const question = (body.question || "").trim();
  if (!question) return fail(res, 400, "missing 'question'");

  if (!(await vllmAlive())) {
    return fail(res, 503, "vLLM unavailable", {
      url: VLLM_URL,
      hint: "start the local vLLM server (Qwen2.5-14B-Instruct-AWQ) on port 8000",
    });
  }

  let content;
  try {
    content = await vllmChat(buildAskPrompt(world, question), {
      maxTokens: 400,
      temperature: 0.2,
    });
  } catch (e) {
    return fail(res, 502, "vLLM call failed: " + e.message);
  }

  const parsed = extractJson(content);
  if (!parsed || typeof parsed !== "object") {
    return fail(res, 502, "could not parse LLM response as JSON", {
      raw: content.slice(0, 500),
    });
  }

  // Normalize the two action shapes.
  if (parsed.action === "match") {
    const idx = Number(parsed.edge_index);
    const edge = (world.edges || []).find((e) => e.index === idx);
    if (!edge) {
      return fail(res, 502, "LLM returned unknown edge_index", {
        edge_index: idx,
        llm_raw: content.slice(0, 500),
      });
    }
    recordQuestion(world, {
      op: "ask/match",
      question,
      edge_index: idx,
    });
    saveWorld(basename, world);
    return json(res, 200, {
      action: "match",
      edge_index: idx,
      edge,
      audio_url: `/api/lectures/${basename}/audio/${idx}`,
    });
  }

  if (parsed.action === "create") {
    const { from_node_id, to_node_id, verb, subtitle, source_evidence } = parsed;
    const nodeIds = new Set(world.nodes.map((n) => n.id));
    if (!nodeIds.has(from_node_id) || !nodeIds.has(to_node_id)) {
      return fail(res, 502, "LLM invented unknown node ids", {
        from_node_id,
        to_node_id,
      });
    }
    // Structural mutation — layout stays stable because addEdge never
    // touches node positions.
    const edge = addEdge(world, {
      from: from_node_id,
      to: to_node_id,
      verb: verb || "",
      subtitle: subtitle || "",
      audioClip: null,
      audioDuration: null,
    });
    edge.source_evidence = source_evidence || null;
    recordQuestion(world, {
      op: "ask/create",
      question,
      edge_index: edge.index,
      from_node_id,
      to_node_id,
      verb,
      subtitle,
      source_evidence,
      tts_status: "pending",
    });
    saveWorld(basename, world);
    return json(res, 200, {
      action: "create",
      edge,
      audio_url: null,
      tts_status: "pending",
      note:
        "Audio generation deferred — Kokoro integration is Phase 2.5. " +
        "The structural edge is persisted; a follow-up /tts call can fill the clip.",
    });
  }

  return fail(res, 502, "LLM returned unknown action", {
    llm_raw: content.slice(0, 500),
  });
}

async function handleInject(req, res, basename) {
  const world = loadWorld(basename);
  if (!world) return fail(res, 404, "lecture not found: " + basename);
  let body;
  try {
    body = await readJsonBody(req);
  } catch (e) {
    return fail(res, 400, e.message);
  }
  const { op, args } = body;
  if (!op || typeof op !== "object" && typeof op !== "string") {
    return fail(res, 400, "missing 'op' (string)");
  }
  const a = args || {};
  try {
    let result;
    switch (op) {
      case "add-edge":
        result = addEdge(world, {
          from: a.from,
          to: a.to,
          verb: a.verb,
          subtitle: a.subtitle,
          audioClip: a.audioClip || null,
          audioDuration: a.audioDuration ?? null,
        });
        break;
      case "remove-edge":
        result = removeEdge(world, { index: Number(a.index) });
        break;
      case "add-node":
        result = addNode(world, {
          id: a.id,
          label: a.label,
          type: a.type || "default",
          clusterId: a.clusterId,
          icon: a.icon || null,
        });
        break;
      case "remove-node":
        result = removeNode(world, { id: a.id });
        break;
      case "move-node":
        result = moveNode(world, { id: a.id, position: a.position });
        break;
      default:
        return fail(res, 400, "unknown op: " + op);
    }
    recordQuestion(world, { op: `inject/${op}`, args: a });
    saveWorld(basename, world);
    return json(res, 200, { ok: true, op, result });
  } catch (e) {
    return fail(res, 400, e.message);
  }
}

// ─── router ─────────────────────────────────────────────────────────────────
// Manual route table — small enough that a match loop is clearer than regex.
const routes = [
  { method: "GET", re: /^\/api\/health$/, handler: (req, res) => handleHealth(req, res) },
  { method: "GET", re: /^\/api\/lectures$/, handler: (req, res) => handleListLectures(req, res) },
  {
    method: "GET",
    re: /^\/api\/lectures\/([^/]+)$/,
    handler: (req, res, m) => handleGetLecture(req, res, m[1]),
  },
  {
    method: "GET",
    re: /^\/api\/lectures\/([^/]+)\/audio\/(\d+)$/,
    handler: (req, res, m) => handleStreamAudio(req, res, m[1], parseInt(m[2], 10)),
  },
  {
    method: "POST",
    re: /^\/api\/lectures\/([^/]+)\/ask$/,
    handler: (req, res, m) => handleAsk(req, res, m[1]),
  },
  {
    method: "POST",
    re: /^\/api\/lectures\/([^/]+)\/inject$/,
    handler: (req, res, m) => handleInject(req, res, m[1]),
  },
];

const server = http.createServer(async (req, res) => {
  try {
    const url = new URL(req.url, `http://${req.headers.host || "localhost"}`);
    const pathname = url.pathname;
    for (const r of routes) {
      if (r.method !== req.method) continue;
      const m = pathname.match(r.re);
      if (!m) continue;
      return await r.handler(req, res, m);
    }
    fail(res, 404, `no route for ${req.method} ${pathname}`);
  } catch (e) {
    console.error("unhandled:", e);
    fail(res, 500, "internal error: " + e.message);
  }
});

server.listen(PORT, () => {
  console.log(
    `lecture-server listening on http://localhost:${PORT}  (lectures: ${LECTURES_DIR}, vLLM: ${VLLM_URL})`,
  );
});
