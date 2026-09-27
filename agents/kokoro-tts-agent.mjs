/**
 * Kokoro TTS adapter — wraps a long-lived Python worker (kokoro-tts-server.py)
 * and exposes the same generateAudio(text, contextId) interface as the OpenAI
 * tts-agent so it can be swapped in transparently.
 *
 * Output is WAV (audio/wav). Returns { base64, duration, mime }.
 */

import { spawn } from 'child_process';
import { fileURLToPath } from 'url';
import path from 'path';
import fs from 'fs';

const __filename = fileURLToPath(import.meta.url);
const __dirname  = path.dirname(__filename);
const PROJECT    = path.resolve(__dirname, '..');

let workerPromise = null;

function startWorker() {
  if (workerPromise) return workerPromise;

  const py     = path.join(PROJECT, '.venv-kokoro/bin/python');
  const script = path.join(PROJECT, 'agents/kokoro-tts-server.py');
  if (!fs.existsSync(py))     throw new Error(`Kokoro venv missing: ${py}`);
  if (!fs.existsSync(script)) throw new Error(`Kokoro server script missing: ${script}`);

  const proc = spawn(py, [script], {
    cwd: PROJECT,
    stdio: ['pipe', 'pipe', 'pipe'],
    env: { ...process.env },
  });

  const pending = new Map(); // id → {resolve, reject}
  let stdoutBuf = '';
  let nextId = 1;
  let ready = false;
  let readyResolve, readyReject;
  const readyPromise = new Promise((res, rej) => { readyResolve = res; readyReject = rej; });

  proc.stdout.on('data', (chunk) => {
    stdoutBuf += chunk.toString('utf8');
    let idx;
    while ((idx = stdoutBuf.indexOf('\n')) >= 0) {
      const line = stdoutBuf.slice(0, idx).trim();
      stdoutBuf = stdoutBuf.slice(idx + 1);
      if (!line) continue;
      let msg;
      try { msg = JSON.parse(line); } catch { continue; }
      if (msg.event === 'ready') { ready = true; readyResolve(); continue; }
      const slot = pending.get(msg.id);
      if (!slot) continue;
      pending.delete(msg.id);
      if (msg.error) slot.reject(new Error(msg.error));
      else slot.resolve(msg);
    }
  });

  proc.stderr.on('data', (chunk) => {
    process.stderr.write('[kokoro] ' + chunk.toString('utf8'));
  });

  proc.on('exit', (code) => {
    const err = new Error(`kokoro worker exited with code ${code}`);
    for (const slot of pending.values()) slot.reject(err);
    pending.clear();
    workerPromise = null;
    if (!ready) readyReject(err);
  });

  workerPromise = readyPromise.then(() => ({
    send(text, voice, speed, lang) {
      return new Promise((resolve, reject) => {
        const id = String(nextId++);
        pending.set(id, { resolve, reject });
        proc.stdin.write(JSON.stringify({ id, text, voice, speed, lang }) + '\n');
      });
    },
    stop() { try { proc.stdin.end(); } catch {} }
  }));

  return workerPromise;
}

/**
 * Preprocess text for TTS: convert numbers with commas to words so Kokoro
 * doesn't read "400,000" as "four zero zero zero zero zero".
 */
function numToWords(n) {
  if (n === 0) return 'zero';
  const ones = ['', 'one', 'two', 'three', 'four', 'five', 'six', 'seven', 'eight', 'nine',
                'ten', 'eleven', 'twelve', 'thirteen', 'fourteen', 'fifteen', 'sixteen',
                'seventeen', 'eighteen', 'nineteen'];
  const tens = ['', '', 'twenty', 'thirty', 'forty', 'fifty', 'sixty', 'seventy', 'eighty', 'ninety'];
  function under1000(num) {
    if (num < 20) return ones[num];
    if (num < 100) return tens[Math.floor(num / 10)] + (num % 10 ? '-' + ones[num % 10] : '');
    return ones[Math.floor(num / 100)] + ' hundred' + (num % 100 ? ' ' + under1000(num % 100) : '');
  }
  if (n < 1000) return under1000(n);
  if (n < 1000000) {
    const thou = Math.floor(n / 1000);
    const rem = n % 1000;
    return under1000(thou) + ' thousand' + (rem ? ' ' + under1000(rem) : '');
  }
  if (n < 1000000000) {
    const mil = Math.floor(n / 1000000);
    const rem = n % 1000000;
    return under1000(mil) + ' million' + (rem ? ' ' + numToWords(rem) : '');
  }
  return String(n);
}

function preprocessForTTS(text) {
  return String(text || '')
    // Convert numbers with commas (e.g. "400,000" → "four hundred thousand")
    .replace(/\b(\d{1,3}(?:,\d{3})+)\b/g, (_, numStr) => {
      const n = parseInt(numStr.replace(/,/g, ''), 10);
      return isFinite(n) ? numToWords(n) : numStr;
    })
    // Convert large standalone numbers (e.g. "5000" → "five thousand")
    .replace(/\b(\d{4,9})\b/g, (_, numStr) => {
      const n = parseInt(numStr, 10);
      if (!isFinite(n)) return numStr;
      // Keep short years (1900-2099) as-is for natural reading
      if (n >= 1900 && n <= 2099) return numStr;
      return numToWords(n);
    });
}

/**
 * Drop-in replacement for tts-agent.generateAudio.
 * Returns { base64, duration, mime, size } or null on failure.
 */
export async function generateAudio(text, contextId) {
  if (!text || !text.trim()) return null;
  try {
    const worker = await startWorker();
    const t0 = Date.now();
    const processedText = preprocessForTTS(text.trim());
    const res = await worker.send(processedText);
    const ms = Date.now() - t0;
    if (!res || !res.wav_b64) return null;
    const size = Math.floor(res.wav_b64.length * 3 / 4);
    if (process.env.KOKORO_LOG) console.log(`[kokoro] ${contextId}: ${res.duration.toFixed(2)}s in ${ms}ms`);
    return { base64: res.wav_b64, duration: res.duration, mime: 'audio/wav', size };
  } catch (err) {
    console.error(`[kokoro] error for ${contextId}:`, err.message);
    return null;
  }
}

export async function shutdown() {
  if (!workerPromise) return;
  try { (await workerPromise).stop(); } catch {}
}
