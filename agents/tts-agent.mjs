/**
 * TTS Agent — OpenAI TTS with quality checks.
 * Ported from lecture_01's tts-agent.mjs with quality pipeline.
 */

import OpenAI from 'openai';
import { execSync } from 'child_process';
import { writeFileSync, unlinkSync, existsSync, mkdirSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';

const EXPECTED_WPM = 155;
const WPM_TOLERANCE = 0.35;

/**
 * Generate TTS audio and return base64 + duration.
 * Includes quality checks: size, duration, silence, clipping.
 */
export async function generateAudio(text, contextId, maxRetries = 1) {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) return null;

  const client = new OpenAI({ apiKey });
  const truncated = text.length > 2000 ? text.substring(0, 2000) + '...' : text;
  const wordCount = truncated.split(/\s+/).length;

  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    try {
      const response = await client.audio.speech.create({
        model: 'tts-1-hd',
        voice: 'nova',
        speed: 0.95,
        input: truncated
      });

      const buffer = Buffer.from(await response.arrayBuffer());

      if (buffer.length < 1000) {
        console.warn(`[TTS] File too small (${buffer.length}B) for ${contextId}, attempt ${attempt + 1}`);
        continue;
      }

      // Get actual duration via ffprobe
      let duration = (wordCount / EXPECTED_WPM) * 60 * (1 / 0.95);
      const tmpPath = join(tmpdir(), `tts_${contextId}_${Date.now()}.mp3`);

      try {
        writeFileSync(tmpPath, buffer);
        const probeOut = execSync(
          `ffprobe -v error -show_entries format=duration -of default=noprint_wrappers=1:nokey=1 "${tmpPath}"`,
          { encoding: 'utf-8', timeout: 5000 }
        ).trim();
        const probeDuration = parseFloat(probeOut);
        if (probeDuration > 0) duration = probeDuration;

        // Silence detection
        try {
          const silenceOut = execSync(
            `ffmpeg -i "${tmpPath}" -af silencedetect=noise=-30dB:d=2.0 -f null - 2>&1`,
            { encoding: 'utf-8', timeout: 10000 }
          );
          const silences = silenceOut.match(/silence_duration: [\d.]+/g) || [];
          if (silences.length > 2) {
            console.warn(`[TTS] ${silences.length} silence gaps detected for ${contextId}`);
          }
        } catch {}

        // Clipping detection
        try {
          const volOut = execSync(
            `ffmpeg -i "${tmpPath}" -af volumedetect -f null - 2>&1`,
            { encoding: 'utf-8', timeout: 10000 }
          );
          const maxVol = volOut.match(/max_volume: ([-\d.]+)/);
          if (maxVol && parseFloat(maxVol[1]) > -0.5) {
            console.warn(`[TTS] Possible clipping for ${contextId}: max_volume=${maxVol[1]}dB`);
          }
        } catch {}
      } catch (probeErr) {
        // ffprobe not available, use estimated duration
      } finally {
        try { if (existsSync(tmpPath)) unlinkSync(tmpPath); } catch {}
      }

      // Word rate check
      const actualWPM = (wordCount / duration) * 60;
      const deviation = Math.abs(duration - ((wordCount / EXPECTED_WPM) * 60)) / ((wordCount / EXPECTED_WPM) * 60);
      if (deviation > WPM_TOLERANCE) {
        console.warn(`[TTS] Word rate deviation ${(deviation * 100).toFixed(0)}% for ${contextId} (${actualWPM.toFixed(0)} WPM)`);
      }

      const base64 = buffer.toString('base64');
      return { base64, duration, size: buffer.length };

    } catch (err) {
      console.error(`[TTS] Error for ${contextId} (attempt ${attempt + 1}):`, err.message);
      if (attempt === maxRetries) return null;
    }
  }

  return null;
}
