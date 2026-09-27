#!/usr/bin/env node
// metric-noun-repetition.mjs — measures repeated-noun rate in the final
// narration of a lecture, used for evaluation.
//
// For every multi-word capitalized noun phrase in the subtitles, count
// how often it reappears within the next K sentences. The metric is:
//   repeat_rate = (# repeated mentions within window K) / (# total mentions)
//
// Lower is better. Reported per-lecture and averaged.
//
// Usage:
//   node tools/metric-noun-repetition.mjs <basename>
//   node tools/metric-noun-repetition.mjs --all
//   node tools/metric-noun-repetition.mjs --all --window 5
//   node tools/metric-noun-repetition.mjs --all --json results/noun_repetition.json

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const REPO_ROOT = path.resolve(__dirname, "..");
const LECTURES_DIR = path.join(REPO_ROOT, "lectures");

function parseArgs(argv) {
  const flags = { _positional: [] };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a.startsWith("--")) {
      const key = a.slice(2);
      const next = argv[i + 1];
      if (next && !next.startsWith("--")) {
        flags[key] = next;
        i++;
      } else flags[key] = true;
    } else flags._positional.push(a);
  }
  return flags;
}

// Extract capitalized proper nouns / noun phrases. We keep multi-token
// sequences starting with a capital letter, excluding common sentence
// starters (e.g., "The", "This", "These") that are not proper nouns.
const SKIP_STARTERS = new Set([
  "The", "This", "These", "Those", "That", "It", "Its", "They", "Their",
  "There", "Here", "A", "An", "And", "But", "Or", "If", "For", "To",
  "Of", "In", "On", "At", "By", "With", "From", "As", "Is", "Are",
  "Was", "Were", "Be", "Been", "Being", "Do", "Does", "Did", "Has",
  "Have", "Had", "We", "Our", "You", "Your", "I", "My", "He", "She",
  "Him", "Her", "Can", "May", "Might", "Will", "Would", "Should",
  "Could", "Also", "Such", "Each", "Both", "Some", "All",
]);

function extractProperNouns(sentence) {
  // Multi-word capitalized sequences (at least one word) that are not
  // sentence-initial common words. Allows acronyms like "GenAI" and "LLM".
  const tokens = sentence.match(/\b[A-Z][a-zA-Z0-9]*(?:\s+[A-Z][a-zA-Z0-9]*)*\b/g) || [];
  const out = [];
  for (const t of tokens) {
    const first = t.split(/\s+/)[0];
    if (SKIP_STARTERS.has(first) && !/[A-Z]{2,}/.test(first)) continue;
    // Skip bare 1-word common starters that happen to begin a sentence.
    // Acronyms (all caps or CamelCase starting with caps) are kept.
    if (t.length < 3) continue;
    out.push(t);
  }
  return out;
}

function normalizeNoun(n) {
  // Treat "GenAI" and "Gen AI" and "generative AI" as same entity for
  // matching purposes. Crude: lowercase + collapse whitespace + remove
  // punctuation.
  return n
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "")
    .trim();
}

function measureLecture(basename, { window }) {
  const lectureDir = path.join(LECTURES_DIR, basename);
  const statePath = path.join(lectureDir, "lecture_state.json");
  if (!fs.existsSync(statePath)) return null;
  const state = JSON.parse(fs.readFileSync(statePath, "utf8"));
  const sentences = (state.edges || []).map((e) => e.subtitle || "");

  let totalMentions = 0;
  let repeatedMentions = 0;
  const allExtracted = [];
  for (let i = 0; i < sentences.length; i++) {
    const nouns = extractProperNouns(sentences[i]);
    allExtracted.push(nouns);
    for (const n of nouns) {
      totalMentions++;
      const norm = normalizeNoun(n);
      // Look back K sentences for the same noun.
      for (let j = Math.max(0, i - window); j < i; j++) {
        const prev = allExtracted[j];
        if (prev.some((p) => normalizeNoun(p) === norm)) {
          repeatedMentions++;
          break;
        }
      }
    }
  }

  const rate = totalMentions > 0 ? repeatedMentions / totalMentions : 0;
  return {
    basename,
    sentences: sentences.length,
    total_mentions: totalMentions,
    repeated_mentions: repeatedMentions,
    repeat_rate: Number(rate.toFixed(4)),
  };
}

function main() {
  const flags = parseArgs(process.argv.slice(2));
  const windowK = flags.window ? parseInt(flags.window, 10) : 5;

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
    console.error("usage: node tools/metric-noun-repetition.mjs <basename>|--all [--window 5]");
    process.exit(1);
  }

  const rows = [];
  for (const b of targets) {
    const r = measureLecture(b, { window: windowK });
    if (r) rows.push(r);
  }

  console.log(`window=${windowK} sentences\n`);
  console.log(
    `${"lecture".padEnd(55)} ${"sentences".padStart(10)} ${"mentions".padStart(10)} ${"repeated".padStart(10)} ${"rate".padStart(8)}`,
  );
  console.log("-".repeat(96));
  let totalT = 0, totalR = 0;
  for (const r of rows) {
    console.log(
      `${r.basename.padEnd(55)} ${String(r.sentences).padStart(10)} ${String(r.total_mentions).padStart(10)} ${String(r.repeated_mentions).padStart(10)} ${r.repeat_rate.toFixed(4).padStart(8)}`,
    );
    totalT += r.total_mentions;
    totalR += r.repeated_mentions;
  }
  console.log("-".repeat(96));
  const avgRate = totalT > 0 ? totalR / totalT : 0;
  console.log(
    `${"AVERAGE".padEnd(55)} ${"".padStart(10)} ${String(totalT).padStart(10)} ${String(totalR).padStart(10)} ${avgRate.toFixed(4).padStart(8)}`,
  );
  if (typeof flags.json === "string") {
    const out = {
      metric: "noun_repetition",
      window: windowK,
      lectures: rows,
      aggregate: {
        num_lectures: rows.length,
        total_sentences: rows.reduce((s, r) => s + r.sentences, 0),
        total_mentions: totalT,
        repeated_mentions: totalR,
        pooled_repeat_rate: avgRate,
        mean_per_lecture_repeat_rate: rows.length ? rows.reduce((s, r) => s + r.repeat_rate, 0) / rows.length : 0,
      },
    };
    fs.mkdirSync(path.dirname(path.resolve(flags.json)), { recursive: true });
    fs.writeFileSync(flags.json, JSON.stringify(out, null, 2) + "\n");
  }
}

main();
