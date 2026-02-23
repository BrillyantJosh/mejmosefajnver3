import { Router, Request, Response } from 'express';
import http from 'http';
import multer from 'multer';
import { getDb } from '../db/connection';

const router = Router();

// Reuse same memory storage pattern as STT/ITT in functions.ts
const audioUpload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 10 * 1024 * 1024 } // 10MB
});

// Helper: build multipart body manually (Node 20 FormData+Blob is unreliable for file uploads)
function buildMultipart(fields: { name: string; value: string }[], file: { name: string; filename: string; contentType: string; data: Buffer }) {
  const boundary = '----WhisperBoundary' + Date.now() + Math.random().toString(36).slice(2);
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

// Helper: HTTP request via http module (more reliable than fetch for multipart in Node 20)
function httpPost(url: string, body: Buffer, contentType: string, timeoutMs: number): Promise<{ status: number; data: string }> {
  return new Promise((resolve, reject) => {
    const parsed = new URL(url);
    const req = http.request({
      hostname: parsed.hostname,
      port: parseInt(parsed.port) || 80,
      path: parsed.pathname,
      method: 'POST',
      timeout: timeoutMs,
      headers: { 'Content-Type': contentType, 'Content-Length': body.length },
    }, (res) => {
      let data = '';
      res.on('data', (chunk: Buffer) => data += chunk.toString());
      res.on('end', () => resolve({ status: res.statusCode || 500, data }));
    });
    req.on('error', reject);
    req.on('timeout', () => { req.destroy(); reject(new Error('Request timeout')); });
    req.write(body);
    req.end();
  });
}

// =============================================
// POST /api/voice/stt — Speech-to-Text via local Whisper
// =============================================
router.post('/stt', audioUpload.single('file'), async (req: Request, res: Response) => {
  try {
    const WHISPER_URL = process.env.WHISPER_URL || 'http://whisper:8000';

    if (!req.file) {
      return res.status(400).json({ error: 'No audio file provided' });
    }

    const language = req.body?.language || 'sl';
    const startTime = Date.now();
    const cleanMime = (req.file.mimetype || 'audio/webm').split(';')[0];

    console.log(`🎙 Voice STT received: ${req.file.originalname}, size=${req.file.size} bytes, mime=${cleanMime}`);

    // Build multipart body manually for Whisper OpenAI-compatible API
    const { body, boundary } = buildMultipart(
      [
        { name: 'model', value: 'whisper-1' },
        { name: 'language', value: language },
        { name: 'response_format', value: 'json' },
      ],
      {
        name: 'file',
        filename: req.file.originalname || 'audio.webm',
        contentType: cleanMime,
        data: req.file.buffer,
      }
    );

    const result = await httpPost(
      `${WHISPER_URL}/v1/audio/transcriptions`,
      body,
      `multipart/form-data; boundary=${boundary}`,
      120000 // 120s timeout — first request loads model
    );

    if (result.status !== 200) {
      console.error(`🎙 Whisper error ${result.status}: ${result.data.slice(0, 300)}`);
      throw new Error(`Whisper error ${result.status}: ${result.data.slice(0, 200)}`);
    }

    const data = JSON.parse(result.data);
    const text = data.text || '';
    const elapsed = Date.now() - startTime;

    console.log(`🎙 Voice STT [${language}]: "${text.slice(0, 80)}..." (${elapsed}ms)`);

    // Log usage (local whisper — no token cost, but track usage)
    try {
      const db = getDb();
      db.prepare(`
        INSERT INTO ai_usage_logs (id, nostr_hex_id, model, prompt_tokens, completion_tokens, total_tokens, cost_usd, cost_lana)
        VALUES (lower(hex(randomblob(16))), ?, ?, ?, ?, ?, ?, ?)
      `).run('voice-stt', 'stt-whisper-local', 0, 0, 0, 0, 0);
    } catch (err) {
      console.error('Failed to log Voice STT usage:', err);
    }

    return res.json({ text: text.trim() });
  } catch (error: any) {
    console.error('Voice STT error:', error.message);
    return res.status(500).json({ error: error.message || 'Speech-to-text failed' });
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

    console.log(`🔊 Voice TTS: ${text.length} chars, voice=${voice}, speed=${speed}`);

    const response = await fetch('https://api.openai.com/v1/audio/speech', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${OPENAI_API_KEY}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model: 'tts-1',
        input: text,
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
