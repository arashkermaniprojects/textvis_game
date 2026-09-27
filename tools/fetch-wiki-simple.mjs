#!/usr/bin/env node
// fetch-wiki-simple.mjs — parallel Wikipedia image fetcher, no LLM.
//
// For each node in graph_data.json that doesn't already have a wiki
// image in <lecture>/overlay_assets/wiki/, do:
//   1. opensearch Wikipedia for the node label → up to K candidate titles
//   2. for each candidate: fetch pageimages (lead image URL)
//   3. download the first candidate that has a usable image
//   4. save as wiki_<node_id>_<n>.jpg
//
// NO LLM calls during fetch. Quality is left to `inspect-images-vl.mjs`.
// Runs candidates in parallel via Promise.all for speed. Writes a
// fetch_report.json alongside.
//
// Usage:
//   node tools/fetch-wiki-simple.mjs <basename>
//   node tools/fetch-wiki-simple.mjs --all
//   node tools/fetch-wiki-simple.mjs --all --max 2        # up to 2 images per node
//   node tools/fetch-wiki-simple.mjs --all --concurrency 6

import fs from "node:fs";
import path from "node:path";
import https from "node:https";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const REPO_ROOT = path.resolve(__dirname, "..");
const LECTURES_DIR = path.join(REPO_ROOT, "lectures");

const LLM_URL = process.env.TEXTVIS_LOCAL_TEXT_URL || "http://127.0.0.1:8000/v1";
const LLM_MODEL = process.env.TEXTVIS_LOCAL_TEXT_MODEL || "Qwen/Qwen2.5-14B-Instruct-AWQ";

function parseArgs(argv) {
  const flags = { _positional: [] };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a.startsWith("--")) {
      const key = a.slice(2);
      const next = argv[i + 1];
      if (next !== undefined && !next.startsWith("--")) {
        flags[key] = next;
        i++;
      } else {
        flags[key] = true;
      }
    } else {
      flags._positional.push(a);
    }
  }
  return flags;
}

// Wikipedia asks identified clients to provide a UA with contact info.
// We're a local research prototype — state that clearly.
const WIKI_UA =
  "TextVis-Game/0.1 (educational lecture prototype; https://github.com/; local research; no public service)";

function httpsGet(url, { asBuffer = false, timeout = 15000 } = {}) {
  return new Promise((resolve, reject) => {
    const req = https.get(
      url,
      {
        family: 4, // Node 18 IPv6 hang workaround
        headers: {
          "User-Agent": WIKI_UA,
          "Accept-Encoding": "identity",
          Accept: asBuffer ? "*/*" : "application/json",
        },
        timeout,
      },
      (res) => {
        if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
          res.resume();
          return resolve(
            httpsGet(new URL(res.headers.location, url).toString(), {
              asBuffer,
              timeout,
            }),
          );
        }
        if (res.statusCode >= 400) {
          res.resume();
          return reject(new Error(`HTTP ${res.statusCode}`));
        }
        const chunks = [];
        res.on("data", (c) => chunks.push(c));
        res.on("end", () => {
          const buf = Buffer.concat(chunks);
          resolve(asBuffer ? buf : buf.toString("utf-8"));
        });
      },
    );
    req.on("error", reject);
    req.on("timeout", () => {
      req.destroy(new Error("timeout"));
    });
  });
}

// Batch-rewrite node labels into Wikipedia-friendly search queries.
// Single LLM call for all nodes of a lecture; much faster than per-node
// calls. Returns a map of node.id → search query. Falls back to the
// label verbatim if rewriting fails for any node.
async function rewriteLabelsForWikipedia(nodes, articleTitle) {
  const entries = nodes.map((n, i) => `${i + 1}. ${n.label || n.id}`).join("\n");
  const prompt = [
    {
      role: "system",
      content:
        "You rewrite verbose graph node labels into short Wikipedia search " +
        "queries. The context is an academic article. Output COMPACT JSON only.",
    },
    {
      role: "user",
      content:
        `Article: "${articleTitle}"\n\n` +
        `Rewrite each numbered label into a short (1-4 word) Wikipedia-searchable ` +
        `query that names the general concept it points at. Drop filler words ` +
        `like "of", "the", "for", adjectives describing the article itself. ` +
        `Prefer named entities, disciplines, or generic terms that have ` +
        `Wikipedia articles.\n\n` +
        `Labels:\n${entries}\n\n` +
        `Return a JSON array of strings, one per label, in the SAME order. ` +
        `Example: ["fuzzy set", "membership function", "Lotfi Zadeh"]`,
    },
  ];
  const body = {
    model: LLM_MODEL,
    messages: prompt,
    max_tokens: Math.min(4000, 40 * nodes.length),
    temperature: 0.1,
    stream: false,
  };
  const res = await fetch(`${LLM_URL}/chat/completions`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    throw new Error(`LLM HTTP ${res.status}`);
  }
  const data = await res.json();
  const content = data?.choices?.[0]?.message?.content || "";
  // Extract JSON array
  const start = content.indexOf("[");
  const end = content.lastIndexOf("]");
  if (start < 0 || end < 0) throw new Error("no JSON array in LLM response");
  let arr;
  try {
    arr = JSON.parse(content.slice(start, end + 1));
  } catch (e) {
    throw new Error("JSON parse: " + e.message);
  }
  if (!Array.isArray(arr)) throw new Error("LLM response not an array");
  const queries = {};
  for (let i = 0; i < nodes.length; i++) {
    const q = arr[i];
    queries[nodes[i].id] =
      typeof q === "string" && q.trim() ? q.trim() : nodes[i].label || nodes[i].id;
  }
  return queries;
}

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

// Serialize every Wikipedia API hit through a single queue with a small
// throttle between requests. Wikipedia enforces per-IP rate limits and
// aggressive parallelism returns "you are making too many requests".
let _wikiChain = Promise.resolve();
const WIKI_DELAY_MS = 120; // ~8 req/s max, well under the typical soft limit

function wikiApi(url) {
  const job = _wikiChain.then(async () => {
    await sleep(WIKI_DELAY_MS);
    for (let attempt = 0; attempt < 3; attempt++) {
      try {
        const text = await httpsGet(url, { timeout: 12000 });
        return text;
      } catch (e) {
        // Retry with backoff on rate limits / transient errors.
        await sleep(500 * (attempt + 1));
      }
    }
    return null;
  });
  _wikiChain = job.catch(() => {});
  return job;
}

async function opensearch(query) {
  const url =
    "https://en.wikipedia.org/w/api.php?action=opensearch&format=json&namespace=0&limit=5&search=" +
    encodeURIComponent(query);
  try {
    const text = await wikiApi(url);
    if (!text) return [];
    const data = JSON.parse(text);
    return data[1] || [];
  } catch (e) {
    return [];
  }
}

async function pageLeadImage(title) {
  const url =
    "https://en.wikipedia.org/w/api.php?action=query&format=json" +
    "&prop=pageimages|pageprops" +
    "&piprop=original" +
    "&titles=" +
    encodeURIComponent(title);
  try {
    const text = await wikiApi(url);
    if (!text) return null;
    const data = JSON.parse(text);
    const pages = data?.query?.pages || {};
    const first = Object.values(pages)[0];
    const original = first?.original?.source;
    if (!original) return null;
    return original;
  } catch (e) {
    return null;
  }
}

async function downloadImage(url, destPath) {
  try {
    const buf = await httpsGet(url, { asBuffer: true, timeout: 30000 });
    if (!buf || buf.length < 1024) return false; // too small, probably error
    fs.writeFileSync(destPath, buf);
    return true;
  } catch (e) {
    return false;
  }
}

function extFromUrl(url) {
  const m = url.match(/\.(jpe?g|png|webp|gif|svg)(?:\?|$)/i);
  if (!m) return ".jpg";
  return "." + m[1].toLowerCase();
}

async function fetchNode({ node, lectureDir, existingStems, maxPerNode, query }) {
  const wikiDir = path.join(lectureDir, "overlay_assets", "wiki");
  const label = node.label || node.id;
  const searchTerm = query || label;

  const titles = await opensearch(searchTerm);
  if (titles.length === 0) {
    return { node_id: node.id, label, status: "no_wiki_results", downloaded: [] };
  }

  const downloaded = [];
  const attempted = [];
  for (const title of titles) {
    if (downloaded.length >= maxPerNode) break;
    const imgUrl = await pageLeadImage(title);
    attempted.push({ title, imgUrl });
    if (!imgUrl) continue;
    // Skip SVGs — they often don't render well in Godot's texture loader.
    if (imgUrl.toLowerCase().endsWith(".svg")) continue;
    const ext = extFromUrl(imgUrl);
    const idx = downloaded.length;
    const stem = `wiki_${node.id}_${idx}`;
    // Skip if we already have this stem
    if (existingStems.has(stem)) {
      downloaded.push({ title, imgUrl, file: `${stem}${ext}`, reused: true });
      continue;
    }
    const filename = `${stem}${ext}`;
    const destPath = path.join(wikiDir, filename);
    const ok = await downloadImage(imgUrl, destPath);
    if (ok) {
      downloaded.push({ title, imgUrl, file: filename });
      existingStems.add(stem);
    }
  }

  return {
    node_id: node.id,
    label,
    status: downloaded.length > 0 ? "ok" : "no_images",
    attempted,
    downloaded,
  };
}

async function runLecture(basename, { maxPerNode, concurrency }) {
  const lectureDir = path.join(LECTURES_DIR, basename);
  if (!fs.existsSync(lectureDir)) {
    console.log(`   skip: no lecture dir`);
    return;
  }
  const graphPath = path.join(lectureDir, "graph_data.json");
  if (!fs.existsSync(graphPath)) {
    console.log(`   skip: no graph_data.json`);
    return;
  }
  const graph = JSON.parse(fs.readFileSync(graphPath, "utf8"));
  const nodes = graph.nodes || [];

  const wikiDir = path.join(lectureDir, "overlay_assets", "wiki");
  fs.mkdirSync(wikiDir, { recursive: true });

  // Track existing image stems so we don't redownload.
  const existingStems = new Set(
    fs
      .readdirSync(wikiDir)
      .filter((f) => /\.(jpe?g|png|webp)$/i.test(f))
      .map((f) => f.replace(/\.[^.]+$/, "")),
  );

  console.log(`\n=== ${basename} (${nodes.length} nodes, ${existingStems.size} existing images) ===`);

  // Batch-rewrite labels via LLM for Wikipedia-friendly queries
  const title = basename.replace(/_/g, " ");
  let queries = {};
  try {
    console.log(`   rewriting ${nodes.length} labels via LLM...`);
    const t_q = Date.now();
    queries = await rewriteLabelsForWikipedia(nodes, title);
    console.log(`   rewrite done in ${((Date.now() - t_q) / 1000).toFixed(1)}s`);
  } catch (e) {
    console.log(`   rewrite FAILED (${e.message}), falling back to raw labels`);
    for (const n of nodes) queries[n.id] = n.label || n.id;
  }

  const results = [];
  const total = nodes.length;
  let active = 0;
  let done = 0;
  let index = 0;

  await new Promise((resolve) => {
    const tick = async () => {
      while (active < concurrency && index < nodes.length) {
        const node = nodes[index++];
        active++;
        fetchNode({ node, lectureDir, existingStems, maxPerNode, query: queries[node.id] })
          .then((r) => {
            done++;
            const stat = r.status === "ok" ? `✓ ${r.downloaded.length}` : `· ${r.status}`;
            console.log(
              `   [${done}/${total}] ${r.node_id.slice(0, 30).padEnd(30)} ${stat}`,
            );
            results.push(r);
          })
          .catch((e) => {
            done++;
            console.log(`   [${done}/${total}] ${node.id} ERROR ${e.message.slice(0, 60)}`);
            results.push({ node_id: node.id, label: node.label, status: "error", error: e.message });
          })
          .finally(() => {
            active--;
            if (done === total) resolve();
            else tick();
          });
      }
    };
    tick();
  });

  const okCount = results.filter((r) => r.status === "ok").length;
  const totalImages = results.reduce(
    (s, r) => s + (r.downloaded ? r.downloaded.length : 0),
    0,
  );
  console.log(`   done: ${okCount}/${total} nodes with images, ${totalImages} total`);

  const reportPath = path.join(lectureDir, "overlay_assets", "fetch_report.json");
  fs.writeFileSync(
    reportPath,
    JSON.stringify(
      {
        basename,
        nodes: results,
        timestamp: new Date().toISOString(),
        max_per_node: maxPerNode,
      },
      null,
      2,
    ),
  );
}

async function main() {
  const flags = parseArgs(process.argv.slice(2));
  const maxPerNode = flags.max ? parseInt(flags.max, 10) : 2;
  // Wikipedia rate-limits; the wikiApi queue enforces serial order
  // regardless. Concurrency here only affects how many nodes have
  // requests PENDING in parallel — keep it small to avoid queue backlog.
  const concurrency = flags.concurrency ? parseInt(flags.concurrency, 10) : 3;

  let targets;
  if (flags.all) {
    targets = fs
      .readdirSync(LECTURES_DIR)
      .filter((d) => fs.statSync(path.join(LECTURES_DIR, d)).isDirectory())
      .sort();
  } else {
    targets = flags._positional;
  }
  if (targets.length === 0) {
    console.error(
      "Usage: node tools/fetch-wiki-simple.mjs <basename>|--all [--max 2] [--concurrency 6]",
    );
    process.exit(1);
  }

  const t0 = Date.now();
  for (const b of targets) {
    await runLecture(b, { maxPerNode, concurrency });
  }
  console.log(`\n=== total wall time: ${((Date.now() - t0) / 1000).toFixed(1)}s ===`);
}

main().catch((e) => {
  console.error("fatal:", e);
  process.exit(1);
});
