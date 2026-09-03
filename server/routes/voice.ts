import { Router, Request, Response } from 'express';
import multer from 'multer';
import * as fs from 'fs';
import * as path from 'path';
import { fileURLToPath } from 'url';
import { getDb } from '../db/connection';

const router = Router();

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
// Same uploads root as server/routes/storage.ts (server/uploads). Used by /stt-path to
// transcribe an ALREADY-uploaded file from disk instead of re-uploading its bytes.
const UPLOADS_DIR = path.resolve(__dirname, '../uploads');
const STT_ALLOWED_BUCKETS = ['dm-audio'];

// Reuse same memory storage pattern as STT/ITT in functions.ts
const audioUpload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 10 * 1024 * 1024 } // 10MB
});

// Helper: build multipart body manually (Node 20 FormData+Blob is unreliable for file uploads)
function buildMultipart(fields: { name: string; value: string }[], file: { name: string; filename: string; contentType: string; data: Buffer }) {
  const boundary = '----GroqBoundary' + Date.now() + Math.random().toString(36).slice(2);
  const parts: Buffer[] = [];

  // File part
  parts.push(Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="${file.name}"; filename="${file.filename}"\r\nContent-Type: ${file.contentType}\r\n\r\n`));
  parts.push(file.data);
  parts.push(Buffer.from('\r\n'));

  // Text fields
  for (const field of fields) {
    parts.push(Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="${field.name}"\r\n\r\n${field.value}\r\n`));
  }

  parts.push(Buffer.from(`--${boundary}--\r\n`));
  return { body: Buffer.concat(parts), boundary };
}

// Core: transcribe an audio Buffer via Groq Whisper (OpenAI-compatible). Shared by
// the multipart /stt route and the by-path /stt-path route.
async function transcribeWithGroq(data: Buffer, filename: string, cleanMime: string, language: string): Promise<string> {
  const GROQ_API_KEY = process.env.GROQ_API_KEY;
  if (!GROQ_API_KEY) throw new Error('GROQ_API_KEY not configured');
  const startTime = Date.now();

  const { body, boundary } = buildMultipart(
    [
      { name: 'model', value: 'whisper-large-v3-turbo' },
      { name: 'language', value: language },
      { name: 'response_format', value: 'json' },
    ],
    { name: 'file', filename, contentType: cleanMime, data },
  );

  const response = await fetch('https://api.groq.com/openai/v1/audio/transcriptions', {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${GROQ_API_KEY}`,
      'Content-Type': `multipart/form-data; boundary=${boundary}`,
    },
    body,
    signal: AbortSignal.timeout(30000),
  });

  if (!response.ok) {
    const errText = await response.text();
    console.error(`🎙 Groq STT error ${response.status}: ${errText.slice(0, 300)}`);
    throw new Error(`Groq STT error ${response.status}: ${errText.slice(0, 200)}`);
  }

  const json = await response.json();
  const text = (json.text || '').trim();
  console.log(`🎙 Voice STT [${language}]: "${text.slice(0, 80)}..." (${Date.now() - startTime}ms)`);

  // Log usage (Groq whisper: ~$0.04/hour audio, negligible per request)
  try {
    const db = getDb();
    const durationSec = data.length / 16000; // rough estimate: 16KB/s
    const costUsd = (durationSec / 3600) * 0.04;
    const costLana = costUsd * 270;
    db.prepare(`
      INSERT INTO ai_usage_logs (id, nostr_hex_id, model, prompt_tokens, completion_tokens, total_tokens, cost_usd, cost_lana)
      VALUES (lower(hex(randomblob(16))), ?, ?, ?, ?, ?, ?, ?)
    `).run('voice-stt', 'groq-whisper-large-v3-turbo', 0, 0, 0, costUsd, costLana);
  } catch (err) {
    console.error('Failed to log Voice STT usage:', err);
  }

  return text;
}

// Core: transcribe via Gemini audio understanding. QUALITY-FIRST for Slovenian:
// on Rok's real recordings (2026-08-03) whisper-large-v3-turbo produced the
// word salad that a week of silence was hung on ("za mojo roč" for "za moj
// rojstni dan", "finčnega stika" for "fizičnega stika"), and the full
// whisper-large-v3 silently DROPPED the first half of one recording — the very
// sentences with the plea in them. Gemini transcribed both completely and
// coherently. It is slower (~20 s vs ~2 s), which is why Groq stays as the
// fallback and the client timeout is raised to accommodate this.
async function transcribeWithGemini(data: Buffer, cleanMime: string, language: string): Promise<string> {
  const GEMINI_API_KEY = process.env.GEMINI_API_KEY;
  if (!GEMINI_API_KEY) throw new Error('GEMINI_API_KEY not configured');
  const model = process.env.VOICE_STT_MODEL || 'gemini-flash-latest';
  const startTime = Date.now();
  const langName = language === 'sl' ? 'Slovenian' : language === 'en' ? 'English' : language;
  const body = {
    contents: [{ role: 'user', parts: [
      { text: `Transcribe the speech in this audio recording verbatim in ${langName}. The speaker may use colloquial ${langName}. Output only the transcript, no commentary, no headings.` },
      { inlineData: { mimeType: cleanMime, data: data.toString('base64') } },
    ]}],
    generationConfig: { maxOutputTokens: 4000, temperature: 0.0 },
  };
  const response = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${GEMINI_API_KEY}`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body), signal: AbortSignal.timeout(30000),
  });
  if (!response.ok) throw new Error(`Gemini STT error ${response.status}: ${(await response.text()).slice(0, 200)}`);
  const json: any = await response.json();
  const text = ((json?.candidates?.[0]?.content?.parts || []).map((p: any) => p.text || '').join('') || '').trim();
  if (!text) throw new Error(`Gemini STT empty (finish=${json?.candidates?.[0]?.finishReason || '?'})`);
  console.log(`🎙 Voice STT gemini [${language}]: "${text.slice(0, 80)}..." (${Date.now() - startTime}ms)`);
  try {
    const db = getDb();
    db.prepare(`
      INSERT INTO ai_usage_logs (id, nostr_hex_id, model, prompt_tokens, completion_tokens, total_tokens, cost_usd, cost_lana)
      VALUES (lower(hex(randomblob(16))), ?, ?, ?, ?, ?, ?, ?)
    `).run('voice-stt', model, 0, 0, 0, 0, 0);
  } catch (err) { console.error('Failed to log Voice STT usage:', err); }
  return text;
}

// Gemini first for quality, Groq turbo as the fast fallback — a transcript
// that arrives mangled is worse than one that arrives late, but one that
// does not arrive at all is worst, so neither path is allowed to be the
// single point of failure.
async function transcribeBest(data: Buffer, filename: string, cleanMime: string, language: string): Promise<string> {
  try {
    return await transcribeWithGemini(data, cleanMime, language);
  } catch (err: any) {
    console.warn(`🎙 Gemini STT failed (${err.message}) — falling back to Groq turbo`);
    return await transcribeWithGroq(data, filename, cleanMime, language);
  }
}

function mimeForExt(ext: string): string {
  switch (ext.toLowerCase()) {
    case '.mp4':
    case '.m4a': return 'audio/mp4';
    case '.mp3':
    case '.mpeg': return 'audio/mpeg';
    case '.aac': return 'audio/aac';
    case '.wav': return 'audio/wav';
    default: return 'audio/webm';
  }
}

// =============================================
// POST /api/voice/stt — Speech-to-Text via Groq Whisper API (multipart file upload)
// =============================================
router.post('/stt', audioUpload.single('file'), async (req: Request, res: Response) => {
  try {
    if (!req.file) return res.status(400).json({ error: 'No audio file provided' });
    const language = req.body?.language || 'sl';
    const cleanMime = (req.file.mimetype || 'audio/webm').split(';')[0];
    console.log(`🎙 Voice STT received: ${req.file.originalname}, size=${req.file.size} bytes, mime=${cleanMime}`);
    const text = await transcribeBest(req.file.buffer, req.file.originalname || 'audio.webm', cleanMime, language);
    return res.json({ text });
  } catch (error: any) {
    console.error('Voice STT error:', error.message);
    return res.status(500).json({ error: error.message || 'Speech-to-text failed' });
  }
});

// =============================================
// POST /api/voice/stt-path — Speech-to-Text for an ALREADY-uploaded file.
// The recorder uploads the audio to storage first, then calls this with {bucket,path}.
// Reading the file from disk avoids a second ~5MB upload of the same bytes (which, run
// concurrently with the storage upload, was overloading weak mobile links -> "Load failed").
// =============================================
router.post('/stt-path', async (req: Request, res: Response) => {
  try {
    const bucket = String(req.body?.bucket || '');
    const rawPath = String(req.body?.path || '');
    const language = req.body?.language || 'sl';

    if (!STT_ALLOWED_BUCKETS.includes(bucket)) return res.status(400).json({ error: 'Invalid bucket' });
    if (!rawPath) return res.status(400).json({ error: 'No path provided' });

    // Sanitize exactly like storage.ts and confirm the resolved path stays inside the bucket dir.
    const safePath = rawPath.replace(/\.\./g, '').replace(/^\//, '');
    const bucketDir = path.join(UPLOADS_DIR, bucket);
    const filePath = path.join(bucketDir, safePath);
    if (!path.resolve(filePath).startsWith(path.resolve(bucketDir) + path.sep)) {
      return res.status(400).json({ error: 'Invalid path' });
    }
    if (!fs.existsSync(filePath)) return res.status(404).json({ error: 'File not found' });

    const data = fs.readFileSync(filePath);
    const cleanMime = mimeForExt(path.extname(filePath));
    console.log(`🎙 Voice STT-path: ${bucket}/${safePath}, size=${data.length} bytes, mime=${cleanMime}`);
    const text = await transcribeBest(data, path.basename(filePath), cleanMime, language);
    return res.json({ text });
  } catch (error: any) {
    console.error('Voice STT-path error:', error.message);
    return res.status(500).json({ error: error.message || 'Speech-to-text failed' });
  }
});

// =============================================
// POST /api/voice/translate — Translate text/transcript to English via Groq (LLM)
// So participants who don't speak the source language can follow the process.
// =============================================
/**
 * Groq retires models without warning: 'llama-3.3-70b-versatile' was pinned
 * here until it vanished from the API, and every translation began failing
 * with "Groq translate error 404" — the feature was simply dead in the UI.
 *
 * So try these in order. A model the API no longer knows is skipped rather
 * than fatal, which turns the next retirement into slightly worse wording
 * instead of a broken button. Both were checked against live Slovenian chat
 * text; reasoning models are deliberately absent, as they emit their own
 * thinking into the reply.
 */
const TRANSLATE_MODELS = ['openai/gpt-oss-120b', 'openai/gpt-oss-20b'];

router.post('/translate', async (req: Request, res: Response) => {
  try {
    const GROQ_API_KEY = process.env.GROQ_API_KEY;
    if (!GROQ_API_KEY) {
      return res.status(500).json({ error: 'GROQ_API_KEY not configured' });
    }
    const text = String(req.body?.text || '').trim();
    if (!text) return res.json({ translation: '' });
    const capped = text.slice(0, 8000); // safety cap

    // `Response` in this file is Express's, so name the fetch one explicitly.
    let response: Awaited<ReturnType<typeof fetch>> | null = null;
    let usedModel = '';
    let lastStatus = 0;
    let lastError = '';

    for (const model of TRANSLATE_MODELS) {
      const attempt = await fetch('https://api.groq.com/openai/v1/chat/completions', {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${GROQ_API_KEY}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          model,
          temperature: 0.2,
          max_tokens: 2048,
          messages: [
            {
              role: 'system',
              content:
                'You are a professional translator. Translate the user message into natural, fluent English. Output ONLY the translation — no quotes, no explanations, no notes. If the text is already in English, return it unchanged.',
            },
            { role: 'user', content: capped },
          ],
        }),
        signal: AbortSignal.timeout(30000),
      });

      if (attempt.ok) {
        response = attempt;
        usedModel = model;
        break;
      }

      lastStatus = attempt.status;
      lastError = await attempt.text();
      console.error(`🌐 Groq translate error ${attempt.status} on ${model}: ${lastError.slice(0, 300)}`);

      // A retired or unknown model is worth trying the next one for; anything
      // else (bad key, rate limit, upstream fault) would fail the same way.
      const retired = attempt.status === 404 || /model/i.test(lastError);
      if (!retired) break;
    }

    if (!response) {
      throw new Error(`Groq translate error ${lastStatus}`);
    }

    const data = (await response.json()) as any;
    const translation = (data?.choices?.[0]?.message?.content || '').trim();

    try {
      const db = getDb();
      const usage = data?.usage || {};
      const promptTokens = usage.prompt_tokens || 0;
      const completionTokens = usage.completion_tokens || 0;
      const totalTokens = usage.total_tokens || promptTokens + completionTokens;
      const costUsd = (promptTokens / 1e6) * 0.59 + (completionTokens / 1e6) * 0.79;
      const costLana = costUsd * 270;
      db.prepare(`
        INSERT INTO ai_usage_logs (id, nostr_hex_id, model, prompt_tokens, completion_tokens, total_tokens, cost_usd, cost_lana)
        VALUES (lower(hex(randomblob(16))), ?, ?, ?, ?, ?, ?, ?)
      `).run('voice-translate', `groq-${usedModel}`, promptTokens, completionTokens, totalTokens, costUsd, costLana);
    } catch (err) {
      console.error('Failed to log translate usage:', err);
    }

    return res.json({ translation });
  } catch (error: any) {
    console.error('Voice translate error:', error.message);
    return res.status(500).json({ error: error.message || 'Translation failed' });
  }
});

// =============================================
// POST /api/voice/tts — Text-to-Speech via OpenAI
// =============================================
router.post('/tts', async (req: Request, res: Response) => {
  try {
    const OPENAI_API_KEY = process.env.OPENAI_API_KEY;
    if (!OPENAI_API_KEY) {
      return res.status(500).json({ error: 'OPENAI_API_KEY not configured' });
    }

    const { text, voice = 'shimmer', speed = 0.95 } = req.body;
    if (!text) {
      return res.status(400).json({ error: 'text is required' });
    }

    // Unauthenticated, and it spends OPENAI_API_KEY per character. /translate
    // has capped its input since it was written; this had no cap at all, so a
    // single request could bill for as much text as it cared to send. 4000 is
    // OpenAI's own ceiling for tts-1.
    const capped = String(text).slice(0, 4000);

    console.log(`🔊 Voice TTS: ${capped.length} chars, voice=${voice}, speed=${speed}`);

    const response = await fetch('https://api.openai.com/v1/audio/speech', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${OPENAI_API_KEY}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model: 'tts-1',
        input: capped,
        voice,
        speed,
        response_format: 'mp3',
      }),
      signal: AbortSignal.timeout(30000),
    });

    if (!response.ok) {
      const err = await response.text();
      console.error(`🔊 OpenAI TTS error ${response.status}: ${err}`);
      throw new Error(`OpenAI TTS error ${response.status}`);
    }

    // Log usage (estimate: ~$0.015 per 1000 chars for tts-1)
    try {
      const db = getDb();
      const costUsd = (text.length / 1000) * 0.015;
      const costLana = costUsd * 270;
      db.prepare(`
        INSERT INTO ai_usage_logs (id, nostr_hex_id, model, prompt_tokens, completion_tokens, total_tokens, cost_usd, cost_lana)
        VALUES (lower(hex(randomblob(16))), ?, ?, ?, ?, ?, ?, ?)
      `).run('voice-tts', 'tts-openai-tts1', text.length, 0, text.length, costUsd, costLana);
      console.log(`🔊 Voice TTS logged: ${text.length} chars, $${costUsd.toFixed(6)} USD`);
    } catch (err) {
      console.error('Failed to log Voice TTS usage:', err);
    }

    // Stream MP3 back to client
    res.setHeader('Content-Type', 'audio/mpeg');
    res.setHeader('Transfer-Encoding', 'chunked');

    const reader = (response.body as ReadableStream<Uint8Array>).getReader();
    const pump = async () => {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        res.write(Buffer.from(value));
      }
      res.end();
    };
    await pump();
  } catch (error: any) {
    console.error('Voice TTS error:', error.message);
    if (!res.headersSent) {
      return res.status(500).json({ error: error.message || 'Text-to-speech failed' });
    }
    res.end();
  }
});

// =============================================
// POST /api/voice/sozitje — Proxy for Sožitje Being API
// =============================================
router.post('/sozitje', async (req: Request, res: Response) => {
  try {
    const SOZITJE_API_URL = process.env.SOZITJE_API_URL || 'https://being2.enlightenedai.org';

    const { path, method = 'POST', body, authHeader } = req.body;
    if (!path) {
      return res.status(400).json({ error: 'path is required' });
    }

    const url = `${SOZITJE_API_URL}${path}`;
    console.log(`🤖 Sožitje proxy: ${method} ${url}`);

    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
    };
    if (authHeader) {
      headers['Authorization'] = authHeader;
    }

    const fetchOptions: RequestInit = {
      method,
      headers,
      signal: AbortSignal.timeout(60000), // 60s timeout for AI responses
    };

    if (body && method !== 'GET') {
      fetchOptions.body = JSON.stringify(body);
    }

    const response = await fetch(url, fetchOptions);

    // Always parse JSON — Sožitje may include mood/response even in error responses
    const data = await response.json().catch(() => ({}));

    if (!response.ok) {
      console.error(`🤖 Sožitje error ${response.status}: ${JSON.stringify(data).slice(0, 200)}`);
    } else {
      console.log(`🤖 Sožitje response: ${JSON.stringify(data).slice(0, 100)}...`);
    }

    // Always forward the data with status — frontend handles partial responses
    return res.json({ ...data, _status: response.status });
  } catch (error: any) {
    console.error('Sožitje proxy error:', error.message);
    return res.status(500).json({ error: error.message || 'Sožitje API failed' });
  }
});

export default router;
