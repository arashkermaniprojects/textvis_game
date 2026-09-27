import OpenAI from 'openai';
import { readFile } from 'fs/promises';
import { existsSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));

let envLoaded = false;
let client = null;

async function loadEnvOnce() {
  if (envLoaded) return;
  envLoaded = true;

  try {
    const envPath = join(__dirname, '..', '.env');
    if (!existsSync(envPath)) return;

    const envContent = await readFile(envPath, 'utf-8');
    for (const line of envContent.split('\n')) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith('#')) continue;
      const eqIdx = trimmed.indexOf('=');
      if (eqIdx <= 0) continue;

      const key = trimmed.substring(0, eqIdx).trim();
      const val = trimmed.substring(eqIdx + 1).trim();
      if (!process.env[key]) process.env[key] = val;
    }
  } catch {}
}

await loadEnvOnce();

// ─── Backend selection ──────────────────────────────────────────────
// TEXTVIS_LLM_BACKEND=local routes chat.completions to a local vLLM server
// (OpenAI-wire-compatible). The two servers stood up next to this project:
//   :8000 — Qwen/Qwen2.5-14B-Instruct-AWQ  (text)
//   :8001 — Qwen/Qwen2.5-VL-7B-Instruct-AWQ (vision)
// Both use an 8192-token context budget — output tokens are clamped to 5000
// in generateText() below so prompts up to ~3000 tokens still fit.
// Default backend is 'api' (unchanged OpenAI behavior).
const LOCAL_TEXT_BASE_URL  = process.env.TEXTVIS_LOCAL_TEXT_URL  || 'http://127.0.0.1:8000/v1';
const LOCAL_TEXT_MODEL     = process.env.TEXTVIS_LOCAL_TEXT_MODEL || 'Qwen/Qwen2.5-14B-Instruct-AWQ';
const LOCAL_CONTEXT_WINDOW = 8192;   // Qwen2.5-14B-Instruct-AWQ, per vLLM --max-model-len
const LOCAL_CTX_SAFETY     = 256;    // keep some slack for chat template + tool framing tokens
const LOCAL_MAX_OUT_CAP    = 5000;   // absolute ceiling even when the prompt is tiny

// Rough token estimator: ~4 chars/token for English (Qwen tokenizer is close to this).
// Over-estimates on purpose so we don't overshoot the context window.
function estimateTokens(str) {
  return Math.ceil(((str || '').length) / 3.5);
}

function getBackend() {
  return (process.env.TEXTVIS_LLM_BACKEND || 'api').toLowerCase();
}

export function getTextModel() {
  if (getBackend() === 'local') return LOCAL_TEXT_MODEL;
  return process.env.OPENAI_CHAT_MODEL || process.env.OPENAI_MODEL || 'gpt-4.1';
}

export function hasOpenAIKey() {
  if (getBackend() === 'local') return true; // vLLM doesn't check the key
  return !!process.env.OPENAI_API_KEY;
}

export function getOpenAIClient() {
  if (!hasOpenAIKey()) return null;
  if (!client) {
    if (getBackend() === 'local') {
      client = new OpenAI({ apiKey: 'local-vllm', baseURL: LOCAL_TEXT_BASE_URL });
      console.log(`[llm] local vLLM backend: ${LOCAL_TEXT_BASE_URL} (${LOCAL_TEXT_MODEL})`);
    } else {
      client = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
    }
  }
  return client;
}

export async function generateText({
  prompt,
  system,
  maxTokens = 1500,
  model,
  temperature
} = {}) {
  const openai = getOpenAIClient();
  if (!openai) return null;

  const messages = [];
  if (system) messages.push({ role: 'system', content: system });
  messages.push({ role: 'user', content: prompt || '' });

  // Clamp output tokens. On the local backend, Qwen2.5-14B-Instruct-AWQ has
  // an 8192-token context window including both input and output. Compute
  // available output budget from the estimated input tokens (with a safety
  // slack for the chat template framing) so very long prompts don't overflow.
  // OpenAI has no such limit, so on 'api' backend we pass maxTokens through.
  let clampedMax = maxTokens || 1500;
  if (getBackend() === 'local') {
    const promptText   = (system || '') + '\n' + (prompt || '');
    const inputTokens  = estimateTokens(promptText);
    const roomForOutput = LOCAL_CONTEXT_WINDOW - inputTokens - LOCAL_CTX_SAFETY;
    const safeMax = Math.max(256, Math.min(LOCAL_MAX_OUT_CAP, roomForOutput));
    if (safeMax < clampedMax) {
      clampedMax = safeMax;
    }
  }

  const request = {
    model: model || getTextModel(),
    messages,
    max_tokens: clampedMax
  };

  if (typeof temperature === 'number') request.temperature = temperature;

  const response = await openai.chat.completions.create(request);
  return response.choices?.[0]?.message?.content?.trim() || '';
}

export function extractJsonObject(text) {
  const match = text?.match(/\{[\s\S]*\}/);
  if (!match) return null;
  try {
    return JSON.parse(match[0]);
  } catch {
    return null;
  }
}

export function extractJsonArray(text) {
  const match = text?.match(/\[[\s\S]*\]/);
  if (!match) return null;
  try {
    return JSON.parse(match[0]);
  } catch {
    return null;
  }
}

export function isAuthError(err) {
  const msg = err?.message || '';
  return err?.status === 401 || /api key|auth|unauthorized|invalid api/i.test(msg);
}
