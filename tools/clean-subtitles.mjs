#!/usr/bin/env node
// clean-subtitles.mjs — fix narration quality issues in a lecture's
// subtitles:
//   (a) same noun repeated in a short interval → replace later
//       mentions with a pronoun (it/this/they) where grammatical
//   (b) pronoun + noun adjacency bugs like "It also GenAI addresses..."
//       produced by post-process-narration.mjs GUARD logic
//   (c) awkward connectors like "It also , businesses..." or
//       "It also to ensure, GenAI must be..."
//
// Works by sending a small sliding window of subtitles to the local
// LLM (Qwen2.5-14B at :8000) and asking for a cleaned rewrite. Writes
// the fixed subtitles back to lectures/<basename>/lecture_state.json
// AND copies to /tmp/textvis_run_<basename>/lecture_state.json so the
// existing regen-from-state.mjs tool can pick up changed clips.
//
// Usage:
//   node tools/clean-subtitles.mjs <basename>
//   node tools/clean-subtitles.mjs <basename> --dry

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const REPO_ROOT = path.resolve(__dirname, "..");

const LLM_URL = process.env.TEXTVIS_LOCAL_TEXT_URL || "http://127.0.0.1:8000/v1";
const LLM_MODEL = process.env.TEXTVIS_LOCAL_TEXT_MODEL || "Qwen/Qwen2.5-14B-Instruct-AWQ";

const basename = process.argv[2];
const dryRun = process.argv.includes("--dry");
if (!basename || basename.startsWith("--")) {
  console.error("usage: node tools/clean-subtitles.mjs <basename> [--dry]");
  process.exit(1);
}

const lectureStatePath = path.join(REPO_ROOT, "lectures", basename, "lecture_state.json");
const workdirStatePath = `/tmp/textvis_run_${basename}/lecture_state.json`;

const primary = fs.existsSync(workdirStatePath) ? workdirStatePath : lectureStatePath;
if (!fs.existsSync(primary)) {
  console.error(`no lecture_state.json found at ${primary}`);
  process.exit(1);
}

const state = JSON.parse(fs.readFileSync(primary, "utf8"));
const originals = state.edges.map((e) => e.subtitle);

// Main topic for the pronoun-replacement prompt: the lecture's own title
// (world_state.json → lecture_state.json → basename).
let LECTURE_TOPIC = state.title || "";
if (!LECTURE_TOPIC) {
  try {
    const ws = JSON.parse(fs.readFileSync(path.join(REPO_ROOT, "lectures", basename, "world_state.json"), "utf8"));
    LECTURE_TOPIC = ws.title || "";
  } catch {}
}
if (!LECTURE_TOPIC) LECTURE_TOPIC = basename.replace(/_/g, " ");

console.log(`[clean-subtitles] ${basename}: ${state.edges.length} edges`);

// Quick regex prefilter — only keep edges whose subtitle has obvious damage.
function looksBad(text, prev) {
  const t = text || "";
  // "It also <ProperNoun> <verb>" — NOUN must be capitalized (case-sensitive).
  if (/\b(It also|And also)\s+(GenAI|AI|ML|DL|LLM|NLP|CNN|RNN|PCG|PPPM|PCM|TCIM|EBM|RL|[A-Z][a-z]+(?:\s+[A-Z][a-z]+)*)\s+[a-z]+/.test(t)) {
    return true;
  }
  // "It also" followed by a preposition or gerund — grammatical break.
  if (/\b(It|it) also\s+(for|to ensure|to make|utilizing|using|about|,)/.test(t)) return true;
  // Stuttering connectors.
  if (/\b(it|It) also\s+(it|It) also\b/.test(t)) return true;
  if (/^\s*(It also|it also)\s+,/.test(t)) return true;
  // Same capitalized multi-word noun appears twice within one subtitle.
  if (/\b([A-Z][a-z]{3,}(?:\s+[A-Z][a-z]+){1,})\b.*\b\1\b/.test(t)) return true;
  // Same capitalized proper noun from the previous subtitle repeated as
  // the first word of this one (e.g. "GenAI ..." right after "... GenAI.").
  if (prev) {
    const words = prev.match(/\b[A-Z][a-zA-Z]{3,}\b/g) || [];
    for (const w of words) {
      const re = new RegExp(`^${w}\\b`);
      if (re.test(t)) return true;
    }
  }
  return false;
}

const candidates = [];
for (let i = 0; i < state.edges.length; i++) {
  const prev = i > 0 ? state.edges[i - 1].subtitle : null;
  if (looksBad(state.edges[i].subtitle, prev)) {
    candidates.push(i);
  }
}
console.log(`[clean-subtitles] ${candidates.length} flagged by prefilter`);

async function llmRewrite(batch) {
  // batch = [{index, prev, curr}]
  const lines = batch
    .map((b, bi) => {
      const prev = b.prev ? `(previous: "${b.prev}")\n` : "";
      return `--- Item ${bi + 1} (edge ${b.index}) ---\n${prev}Current: "${b.curr}"`;
    })
    .join("\n\n");

  const messages = [
    {
      role: "system",
      content:
        "You are a narration editor for an educational lecture. Fix these quality issues in each item:\n" +
        '1. "It also <ProperNoun> <verb>..." should become "<ProperNoun> also <verb>..." OR "It also <verb>..." — NEVER keep both the pronoun "it" AND the noun adjacent.\n' +
        '2. "It also <preposition>..." (like "It also for", "It also to ensure", "It also utilizing") should drop "It also" entirely.\n' +
        '3. "It also , ..." (with stray comma) should become "Additionally, ..." or drop "It also ,".\n' +
        '4. If the SAME proper noun from the previous sentence is repeated at the start of the current one, replace it with "It" or "This".\n' +
        "5. If the same proper noun appears twice within one sentence, replace the second mention with a pronoun.\n" +
        "6. Preserve the factual content. Keep the same key verbs and objects. Never add new claims.\n" +
        "Respond with COMPACT JSON only, no prose outside JSON.",
    },
    {
      role: "user",
      content:
        `Rewrite each item's Current text to fix the issues above. Output a JSON array of strings, one cleaned subtitle per item, in the same order. Nothing else.\n\n${lines}`,
    },
  ];

  const body = {
    model: LLM_MODEL,
    messages,
    max_tokens: Math.min(3000, 120 * batch.length),
    temperature: 0.1,
    stream: false,
  };
  const res = await fetch(`${LLM_URL}/chat/completions`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!res.ok) throw new Error(`LLM HTTP ${res.status}`);
  const data = await res.json();
  const content = data?.choices?.[0]?.message?.content || "";
  const start = content.indexOf("[");
  const end = content.lastIndexOf("]");
  if (start < 0 || end < 0) throw new Error(`no JSON array in response: ${content.slice(0, 200)}`);
  const arr = JSON.parse(content.slice(start, end + 1));
  if (!Array.isArray(arr) || arr.length !== batch.length) {
    throw new Error(`expected ${batch.length} items, got ${Array.isArray(arr) ? arr.length : "not-array"}`);
  }
  return arr.map((s) => (typeof s === "string" ? s : ""));
}

// Global pronoun pass — rewrite the FULL subtitle list with an LLM so that
// repeated proper nouns (like "GenAI", "AI", "ML") are collapsed to "it",
// "this", "they" where grammatical. Uses overlapping sliding windows so
// the LLM has enough context to know which noun is "recent".
async function globalPronounPass() {
  const WINDOW = 8;
  const OVERLAP = 2;
  const updates = new Map();

  for (let start = 0; start < state.edges.length; start += WINDOW - OVERLAP) {
    const slice = state.edges.slice(start, start + WINDOW);
    if (slice.length === 0) break;
    const items = slice.map((e, k) => `${start + k + 1}. ${e.subtitle}`).join("\n");

    const messages = [
      {
        role: "system",
        content:
          "You are a narration editor for a spoken educational lecture. The lecture is about one main topic (e.g. 'GenAI', 'algorithmic pricing', 'ayurveda'). The listener hears the sentences in order. Your job is to make the narration sound NATURAL by REPLACING repeated mentions of the main topic with pronouns. GOAL: within any 5-sentence window, the main topic name should appear at most ONCE — every other mention becomes a pronoun.\n\n" +
          "AGGRESSIVE REPLACEMENT RULES:\n" +
          "1. If the main topic (e.g. 'GenAI', 'Gen AI', 'generative AI', 'AI') was mentioned in ANY of the previous 1-4 sentences, REPLACE its appearance in the current sentence with an appropriate pronoun ('it', 'this', 'they', 'its') — even if the mention is not the subject.\n" +
          "   Examples:\n" +
          "   - 'through GenAI' → 'through it'\n" +
          "   - 'capabilities of GenAI' → 'its capabilities' OR 'capabilities it has'\n" +
          "   - 'GenAI tools' → 'these tools' OR 'such tools'\n" +
          "   - 'GenAI's transformative power' → 'its transformative power'\n" +
          "   - 'the adoption of GenAI' → 'its adoption'\n" +
          "2. If one sentence mentions the main topic TWICE (e.g. 'Customer interaction through Gen AI includes the use of GenAI'), keep only the first mention and replace the second with a pronoun.\n" +
          "3. NEVER allow both the noun and a pronoun referring to it in the same sentence as adjacent tokens (e.g. 'It also GenAI addresses' is wrong; 'GenAI addresses' OR 'It also addresses' are fine).\n" +
          "4. Keep the FIRST mention in each window (so the listener knows what 'it' refers to) unless the current sentence is already the 2nd+ in a chain.\n" +
          "5. Preserve every factual claim, every verb, every object. Do not reorder or merge sentences. 1:1 correspondence.\n" +
          "6. If a sentence has zero mentions of the main topic, leave it completely unchanged.\n" +
          "7. Keep sentences grammatical — prefer 'its' over 'of it', 'these' over 'it tools', rephrase only as much as needed to keep it readable.\n" +
          "Output COMPACT JSON only — an array of strings, one per input sentence, in order.",
      },
      {
        role: "user",
        content: `Apply the rules above to these ${slice.length} consecutive lecture sentences. The main topic of this lecture is the subject of \"${LECTURE_TOPIC}\". Be AGGRESSIVE about replacing repeated mentions. Return a JSON array of ${slice.length} strings, nothing else.\n\n${items}`,
      },
    ];

    const body = {
      model: LLM_MODEL,
      messages,
      max_tokens: Math.min(4000, 120 * slice.length),
      temperature: 0.1,
      stream: false,
    };
    process.stdout.write(`  window [${start}..${start + slice.length - 1}]...`);
    try {
      const res = await fetch(`${LLM_URL}/chat/completions`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json();
      const content = data?.choices?.[0]?.message?.content || "";
      const js = content.indexOf("[");
      const je = content.lastIndexOf("]");
      if (js < 0 || je < 0) throw new Error("no JSON array");
      const arr = JSON.parse(content.slice(js, je + 1));
      if (!Array.isArray(arr) || arr.length !== slice.length) {
        throw new Error(`got ${Array.isArray(arr) ? arr.length : "non-array"}, expected ${slice.length}`);
      }
      // Only record changes for the new-window part (skip overlap prefix).
      const overlapSkip = start === 0 ? 0 : OVERLAP;
      for (let k = overlapSkip; k < slice.length; k++) {
        const original = slice[k].subtitle;
        const cleaned = typeof arr[k] === "string" ? arr[k].trim() : "";
        if (cleaned && cleaned !== original) {
          updates.set(start + k, cleaned);
        }
      }
      console.log(" ok");
    } catch (e) {
      console.log(` FAILED: ${e.message}`);
    }
  }

  return updates;
}

async function main() {
  const BATCH = 6;
  const rewrites = new Map();
  if (candidates.length === 0) {
    console.log("[clean-subtitles] targeted pass: nothing flagged");
  }
  for (let i = 0; i < candidates.length; i += BATCH) {
    const slice = candidates.slice(i, i + BATCH);
    const batch = slice.map((idx) => ({
      index: idx,
      prev: idx > 0 ? state.edges[idx - 1].subtitle : null,
      curr: state.edges[idx].subtitle,
    }));
    process.stdout.write(`  batch ${Math.floor(i / BATCH) + 1}/${Math.ceil(candidates.length / BATCH)}...`);
    try {
      const result = await llmRewrite(batch);
      for (let k = 0; k < slice.length; k++) {
        const original = state.edges[slice[k]].subtitle;
        const cleaned = (result[k] || "").trim();
        if (cleaned && cleaned !== original) {
          rewrites.set(slice[k], cleaned);
        }
      }
      console.log(` ok`);
    } catch (e) {
      console.log(` FAILED: ${e.message}`);
    }
  }

  console.log(`[clean-subtitles] targeted pass: rewrote ${rewrites.size} / ${candidates.length}`);
  // Apply targeted rewrites first so the global pass sees the cleaned text.
  for (const [idx, cleaned] of rewrites) {
    state.edges[idx].subtitle = cleaned;
  }

  // Global pronoun pass — sliding window over the entire narration.
  console.log(`[clean-subtitles] global pronoun pass over ${state.edges.length} edges...`);
  const globalUpdates = await globalPronounPass();
  for (const [idx, cleaned] of globalUpdates) {
    state.edges[idx].subtitle = cleaned;
    if (!rewrites.has(idx)) rewrites.set(idx, cleaned);
  }
  console.log(`[clean-subtitles] global pass: rewrote ${globalUpdates.size} edges`);

  // Log every change we actually made.
  for (const [idx, _cleaned] of [...rewrites.entries()].sort((a, b) => a[0] - b[0])) {
    // originals[] was captured at the start of the script from the fresh state
    console.log(`  [${idx}] OLD: ${originals[idx]}`);
    console.log(`  [${idx}] NEW: ${state.edges[idx].subtitle}`);
  }

  if (dryRun) {
    console.log("[clean-subtitles] --dry: not writing");
    return;
  }

  // Write to the primary source (either workdir or local)
  fs.writeFileSync(primary, JSON.stringify(state, null, 2));
  console.log(`[clean-subtitles] wrote ${primary}`);

  // Also write to the other location if it exists
  if (primary === workdirStatePath && fs.existsSync(lectureStatePath)) {
    const local = JSON.parse(fs.readFileSync(lectureStatePath, "utf8"));
    for (const [idx, cleaned] of rewrites) {
      if (local.edges[idx]) local.edges[idx].subtitle = cleaned;
    }
    fs.writeFileSync(lectureStatePath, JSON.stringify(local, null, 2));
    console.log(`[clean-subtitles] also wrote ${lectureStatePath}`);
  } else if (primary === lectureStatePath && fs.existsSync(workdirStatePath)) {
    const wd = JSON.parse(fs.readFileSync(workdirStatePath, "utf8"));
    for (const [idx, cleaned] of rewrites) {
      if (wd.edges[idx]) wd.edges[idx].subtitle = cleaned;
    }
    fs.writeFileSync(workdirStatePath, JSON.stringify(wd, null, 2));
    console.log(`[clean-subtitles] also wrote ${workdirStatePath}`);
  }
}

main().catch((e) => {
  console.error("fatal:", e);
  process.exit(1);
});
