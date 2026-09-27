#!/usr/bin/env python3
"""
Long-lived Kokoro TTS worker.

Reads one JSON request per line on stdin, writes one JSON response per line on stdout.
Request:  {"id": str, "text": str, "voice": str (opt), "speed": float (opt), "lang": str (opt)}
Response: {"id": str, "wav_b64": str, "duration": float, "rate": int}
Error:    {"id": str, "error": str}

The model is loaded once at startup so per-call cost is just synthesis.
"""
import sys, os, json, base64, io, traceback

def log(msg):
    print(msg, file=sys.stderr, flush=True)

def main():
    model_path = os.environ.get('KOKORO_MODEL', '.kokoro-models/kokoro-v1.0.onnx')
    voices_path = os.environ.get('KOKORO_VOICES', '.kokoro-models/voices-v1.0.bin')
    default_voice = os.environ.get('KOKORO_VOICE', 'af_heart')
    default_speed = float(os.environ.get('KOKORO_SPEED', '1.0'))
    default_lang  = os.environ.get('KOKORO_LANG', 'en-us')

    log(f'[kokoro] loading model={model_path} voices={voices_path}')
    from kokoro_onnx import Kokoro
    import soundfile as sf
    k = Kokoro(model_path, voices_path)
    log('[kokoro] ready')
    print(json.dumps({'event': 'ready'}), flush=True)

    for line in sys.stdin:
        line = line.strip()
        if not line:
            continue
        req_id = None
        try:
            req = json.loads(line)
            req_id = req.get('id')
            text  = (req.get('text') or '').strip()
            if not text:
                print(json.dumps({'id': req_id, 'error': 'empty text'}), flush=True)
                continue
            voice = req.get('voice', default_voice)
            speed = float(req.get('speed', default_speed))
            lang  = req.get('lang',  default_lang)

            samples, rate = k.create(text, voice=voice, speed=speed, lang=lang)
            buf = io.BytesIO()
            sf.write(buf, samples, rate, format='WAV', subtype='PCM_16')
            wav_bytes = buf.getvalue()
            duration = len(samples) / float(rate)
            print(json.dumps({
                'id': req_id,
                'wav_b64': base64.b64encode(wav_bytes).decode('ascii'),
                'duration': duration,
                'rate': rate,
            }), flush=True)
        except Exception as e:
            log('[kokoro] error: ' + traceback.format_exc())
            print(json.dumps({'id': req_id, 'error': str(e)}), flush=True)

if __name__ == '__main__':
    main()
