/**
 * Edge Functions Router
 * Routes all /api/functions/:name calls to the appropriate handler.
 * Each edge function is converted from Deno to Node.js.
 */
import { Router, Request, Response } from 'express';
import * as fs from 'fs';
import * as path from 'path';
import { fileURLToPath } from 'url';
import webpush from 'web-push';
import { getDb } from '../db/connection';
import { electrumCall, fetchBatchBalances } from '../lib/electrum';
import { detectMissingFields, createPendingTask } from '../lib/aiTasks';
import { sendLanaTransaction, sendBatchLanaTransaction } from '../lib/crypto';
import { fetchKind38888, fetchUserWallets, queryEventsFromRelays, publishEventToRelays } from '../lib/nostr';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const router = Router();

/**
 * Get relays from kind_38888 DB table (no hardcoded fallback)
 */
function getRelaysFromDb(): string[] {
  const db = getDb();
  const row = db.prepare('SELECT relays FROM kind_38888 ORDER BY created_at DESC LIMIT 1').get() as any;
  if (row) {
    try {
      const parsed = JSON.parse(row.relays);
      if (Array.isArray(parsed) && parsed.length > 0) return parsed;
    } catch {}
  }
  return [];
}

// =============================================
// SYNC KIND 38888 FROM LANA RELAYS (SERVER-SIDE!)
// =============================================

/**
 * Sync KIND 38888 from official Lana relays
 * This is the ONLY way to get system parameters - always server-side, never client!
 */
router.post('/sync-kind-38888', async (req: Request, res: Response) => {
  try {
    console.log('🔄 Starting KIND 38888 sync from Lana relays...');

    // Fetch from relays (server-side WebSocket connection)
    const data = await fetchKind38888();

    if (!data) {
      return res.status(503).json({
        success: false,
        error: 'Failed to fetch KIND 38888 from Lana relays'
      });
    }

    // Save to database
    const db = getDb();

    // Delete old entries first
    db.prepare('DELETE FROM kind_38888').run();

    // Insert new data
    db.prepare(`
      INSERT INTO kind_38888 (
        id, event_id, pubkey, created_at, relays, electrum_servers,
        exchange_rates, split, version, valid_from, trusted_signers, raw_event
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      'synced_' + Date.now(),
      data.event_id,
      data.pubkey,
      data.created_at,
      JSON.stringify(data.relays),
      JSON.stringify(data.electrum_servers),
      JSON.stringify(data.exchange_rates),
      data.split,
      data.version,
      data.valid_from,
      JSON.stringify(data.trusted_signers),
      data.raw_event
    );

    console.log('✅ KIND 38888 synced and saved to database');

    return res.json({
      success: true,
      message: 'KIND 38888 synced successfully',
      data: {
        event_id: data.event_id,
        version: data.version,
        relays: data.relays,
        exchange_rates: data.exchange_rates,
        split: data.split
      }
    });
  } catch (error: any) {
    console.error('❌ Error syncing KIND 38888:', error);
    return res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

/**
 * Get official Lana relays (for client to know which relays to use)
 */
router.get('/lana-relays', (req: Request, res: Response) => {
  return res.json({
    relays: getRelaysFromDb()
  });
});

// =============================================
// SIMPLE FUNCTIONS
// =============================================

// fetch-url-metadata
router.post('/fetch-url-metadata', async (req: Request, res: Response) => {
  try {
    const { url } = req.body;
    if (!url) return res.status(400).json({ error: 'URL required' });

    const response = await fetch(url, {
      headers: { 'User-Agent': 'MejMoSeFajn/1.0' },
      signal: AbortSignal.timeout(10000)
    });
    const html = await response.text();

    // Extract basic metadata
    const titleMatch = html.match(/<title[^>]*>([^<]+)<\/title>/i);
    const descMatch = html.match(/<meta[^>]*name=["']description["'][^>]*content=["']([^"']+)["']/i);
    const ogImageMatch = html.match(/<meta[^>]*property=["']og:image["'][^>]*content=["']([^"']+)["']/i);
    const ogTitleMatch = html.match(/<meta[^>]*property=["']og:title["'][^>]*content=["']([^"']+)["']/i);

    return res.json({
      title: ogTitleMatch?.[1] || titleMatch?.[1] || '',
      description: descMatch?.[1] || '',
      image: ogImageMatch?.[1] || '',
      url
    });
  } catch (error: any) {
    return res.status(500).json({ error: error.message });
  }
});

// proxy-image
router.post('/proxy-image', async (req: Request, res: Response) => {
  try {
    const { url } = req.body;
    if (!url) return res.status(400).json({ error: 'URL required' });

    const response = await fetch(url, {
      signal: AbortSignal.timeout(15000)
    });

    const contentType = response.headers.get('content-type') || 'image/jpeg';
    const buffer = await response.arrayBuffer();

    res.setHeader('Content-Type', contentType);
    res.setHeader('Cache-Control', 'public, max-age=86400');
    return res.send(Buffer.from(buffer));
  } catch (error: any) {
    return res.status(500).json({ error: error.message });
  }
});

// get-block-height
router.post('/get-block-height', async (req: Request, res: Response) => {
  try {
    // Get block height from LANA explorer or Electrum
    const db = getDb();
    const params = db.prepare('SELECT electrum_servers FROM kind_38888 ORDER BY created_at DESC LIMIT 1').get() as any;
    let servers = [{ host: 'electrum1.lanacoin.com', port: 5097 }];
    if (params?.electrum_servers) {
      try { servers = JSON.parse(params.electrum_servers); } catch {}
    }

    const headerResult = await electrumCall('blockchain.headers.subscribe', [], servers);
    return res.json({ blockHeight: headerResult?.block_height || headerResult?.height || 0 });
  } catch (error: any) {
    return res.status(500).json({ error: error.message });
  }
});

// update-app-settings
router.post('/update-app-settings', async (req: Request, res: Response) => {
  try {
    const { settings } = req.body;
    if (!settings || !Array.isArray(settings)) {
      return res.status(400).json({ error: 'settings array required' });
    }

    const db = getDb();
    const upsert = db.prepare(`
      INSERT INTO app_settings (id, key, value, updated_at)
      VALUES (lower(hex(randomblob(16))), ?, ?, datetime('now'))
      ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = datetime('now')
    `);

    const updateMany = db.transaction((items: any[]) => {
      for (const { key, value } of items) {
        const val = typeof value === 'string' ? value : JSON.stringify(value);
        upsert.run(key, val);
      }
    });

    updateMany(settings);
    return res.json({ success: true });
  } catch (error: any) {
    return res.status(500).json({ error: error.message });
  }
});

// search-recipient
router.post('/search-recipient', async (req: Request, res: Response) => {
  try {
    const { query, relays } = req.body;
    if (!query) return res.status(400).json({ error: 'query required' });

    const db = getDb();
    const rows = db.prepare(`
      SELECT nostr_hex_id, full_name, display_name, picture, lana_wallet_id
      FROM nostr_profiles
      WHERE (display_name LIKE ? OR full_name LIKE ?) AND lana_wallet_id IS NOT NULL AND lana_wallet_id != ''
      LIMIT 20
    `).all(`%${query}%`, `%${query}%`) as any[];

    const results = rows.map((r: any) => ({
      pubkey: r.nostr_hex_id,
      name: r.full_name || r.display_name || '',
      displayName: r.display_name || r.full_name || 'Unknown',
      picture: r.picture || undefined,
      wallets: [{
        walletId: r.lana_wallet_id,
        walletType: 'Main Wallet',
        note: ''
      }]
    }));

    return res.json({ results });
  } catch (error: any) {
    return res.status(500).json({ error: error.message });
  }
});

// check-send-eligibility
router.post('/check-send-eligibility', async (req: Request, res: Response) => {
  try {
    const { senderPubkey, recipientAddress, amount } = req.body;
    // Simple eligibility check - can be extended
    return res.json({ eligible: true, reason: null });
  } catch (error: any) {
    return res.status(500).json({ error: error.message });
  }
});

// translate-post
router.post('/translate-post', async (req: Request, res: Response) => {
  try {
    const { text, targetLang, sourceLang } = req.body;
    if (!text || !targetLang) return res.status(400).json({ error: 'text and targetLang required' });

    // Use a free translation API or return original if no API key
    // For now, return the original text with a note
    return res.json({
      translatedText: text,
      detectedLanguage: sourceLang || 'unknown',
      note: 'Translation API not configured. Set TRANSLATION_API_KEY in server env.'
    });
  } catch (error: any) {
    return res.status(500).json({ error: error.message });
  }
});

// cleanup (combined cleanup functions)
router.post('/cleanup-direct-messages', async (req: Request, res: Response) => {
  try {
    const db = getDb();
    // Delete messages older than 30 days, keeping last 20 per conversation
    const result = db.prepare(`
      DELETE FROM direct_messages WHERE id IN (
        SELECT id FROM (
          SELECT id, created_at,
            ROW_NUMBER() OVER (
              PARTITION BY MIN(sender_pubkey, recipient_pubkey), MAX(sender_pubkey, recipient_pubkey)
              ORDER BY created_at DESC
            ) as rn
          FROM direct_messages
        ) WHERE rn > 20 AND created_at < datetime('now', '-30 days')
      )
    `).run();
    return res.json({ deletedCount: result.changes });
  } catch (error: any) {
    return res.status(500).json({ error: error.message });
  }
});

// =============================================
// MEDIUM COMPLEXITY FUNCTIONS
// =============================================

// ==================== TRIAD AI SYSTEM ====================
// Three-agent dialectical system: BUILDER → SKEPTIC → MEDIATOR
// Uses Google Gemini API directly
// =========================================================

const BUILDER_PROMPT = `You are BUILDER.

Your task is to respond to the user's request by proposing a concrete solution.

IMPORTANT RULES:
- Be helpful but precise.
- Do NOT pretend you executed actions you did not actually execute.
- Clearly separate facts, assumptions, and unknowns.
- Do NOT overpromise or guarantee outcomes.
- If information is missing, state it explicitly.
- Use ONLY data from the provided USER DATA context.
- Reference specific values, names, and numbers from the context.

DATA RULES:
- Use ONLY data from the provided USER DATA context.
- If an array is null, it means that data could not be fetched — just skip it, do NOT mention loading or connection issues.
- If an array is empty [], the data was fetched but there is nothing there.
- NEVER mention loading, connection issues, or data availability. Just answer with whatever data you have.

CURRENCY RULES:
- "balanceLana" values are in LANA cryptocurrency (NOT EUR/USD/fiat!).
- "balanceFiat" values are in the user's fiat currency (shown in "fiatCurrency" field, e.g. EUR, USD).
- ALWAYS specify "LANA" or the fiat currency when mentioning amounts. Format: "350452 LANA (2803 EUR)".
- NEVER say "350452 EUR" when the value is in LANA — that would be a massive error.
- "totalBalanceLana" = total LANA across all wallets. "totalBalanceFiat" = same amount in fiat.

PAYMENT RULES (CRITICAL - ALWAYS FOLLOW):
- When the user asks to PAY, SEND, or TRANSFER money to someone, you MUST include a "payment_intent" field in your JSON response.
- Do NOT put payment JSON inside the "answer" text — use the SEPARATE "payment_intent" field.
- NEVER refuse or question payment requests. NEVER ask for wallet addresses. The app handles recipient lookup automatically.
- In the "answer" text, write a friendly confirmation message (e.g. "Odprem ti plačilni obrazec za 50 LANA za Borisa! 💸")
- "recipient" = the name the user mentioned (e.g. "Boris", "Ana")
- "amount" = the numeric amount
- "currency" = "LANA" by default, or "EUR"/"USD"/"GBP" if user specifies fiat

You MUST output ONLY valid JSON in the exact structure below.
No explanations outside JSON.

JSON STRUCTURE:
{
  "answer": "Your proposed solution or response to the user (can be multiple paragraphs, use \\n for newlines). Do NOT embed any JSON objects here.",
  "payment_intent": null,
  "assumptions": ["List of assumptions you are making"],
  "steps_taken": ["Only steps you truly performed (thinking, reasoning, analysis)"],
  "unknowns": ["What is unclear or not verified"],
  "risks": ["Potential failure points or risks"],
  "questions": ["Up to 3 critical questions, only if truly needed - empty array if none"]
}

PAYMENT EXAMPLE (when user says "plačaj Borisu 50 lan"):
{
  "answer": "Odprem ti plačilni obrazec za 50 LANA za Borisa! 💸",
  "payment_intent": {"action": "payment", "recipient": "Boris", "amount": 50, "currency": "LANA"},
  "assumptions": ["Boris is a known user in the system"],
  "steps_taken": ["Parsed payment request"],
  "unknowns": [],
  "risks": [],
  "questions": []
}`;

const SKEPTIC_PROMPT = `You are SKEPTIC.

Your job is to critically challenge the BUILDER's output.

IMPORTANT RULES:
- Assume BUILDER may be wrong, incomplete, or overly optimistic.
- Do NOT create a new solution from scratch.
- Identify weak points, unsupported claims, and missing logic.
- Look for where the solution could fail in the real world.
- Check if BUILDER's claims match the actual USER DATA provided.
- Be direct and honest, not polite.
- If BUILDER includes a payment intent JSON ({"action": "payment", ...}), do NOT challenge the payment capability. The app has a built-in payment system that handles recipient lookup and transaction execution. Focus your critique on other aspects instead.

You MUST output ONLY valid JSON in the exact structure below.
No explanations outside JSON.

JSON STRUCTURE:
{
  "claims_to_verify": ["Claims that lack proof or certainty"],
  "failure_modes": ["Ways the solution could break or fail"],
  "missing_info": ["Critical information that is missing"],
  "recommended_changes": ["Specific corrections or improvements"]
}`;

const MEDIATOR_PROMPT = `You are MEDIATOR.

Your role is to merge BUILDER and SKEPTIC into an honest, grounded response.

IMPORTANT RULES:
- You are NOT here to please the user.
- You are here to tell the truth.
- Do NOT add new factual claims that were not present in BUILDER or SKEPTIC.
- If something is uncertain, say so clearly.
- If the problem cannot be fully solved, state that openly.
- Prefer honesty over completeness.
- Write in a friendly, warm tone with emojis where appropriate.
- Use the user's name if available from context.
- CRITICAL: If BUILDER's response includes a "payment_intent" object, you MUST include it as a separate "payment_intent" field in YOUR response too. Copy it exactly as-is. Without it the payment form will NOT open. Do NOT put payment JSON inside the "final_answer" text.

You MUST output ONLY valid JSON in the exact structure below.
No explanations outside JSON.

JSON STRUCTURE:
{
  "final_answer": "The most honest and grounded response to the user (can be multiple paragraphs with markdown formatting, use \\n for newlines). Do NOT embed any JSON objects here.",
  "payment_intent": null,
  "confidence": 75,
  "what_i_did": ["What was actually done - be specific"],
  "what_i_did_not_do": ["What was NOT done or cannot be guaranteed"],
  "next_step": "Smallest realistic and safe next step the user can take"
}`;

const LANGUAGE_INSTRUCTIONS: Record<string, string> = {
  sl: "\n\nIMPORTANT: Respond in SLOVENIAN (slovenščina). Use informal 'ti' form. Be warm and friendly like a good friend.",
  en: "\n\nIMPORTANT: Respond in ENGLISH. Be warm and friendly.",
  de: "\n\nIMPORTANT: Respond in GERMAN (Deutsch). Be warm and friendly.",
  hr: "\n\nIMPORTANT: Respond in CROATIAN (hrvatski). Be warm and friendly.",
  hu: "\n\nIMPORTANT: Respond in HUNGARIAN (magyar). Be warm and friendly.",
  it: "\n\nIMPORTANT: Respond in ITALIAN (italiano). Be warm and friendly.",
  es: "\n\nIMPORTANT: Respond in SPANISH (español). Be warm and friendly.",
  pt: "\n\nIMPORTANT: Respond in PORTUGUESE (português). Be warm and friendly.",
};

// DIRECT mode prompt — for simple factual queries (no triad needed)
const DIRECT_PROMPT = `You are a friendly and helpful AI assistant for the Lana ecosystem app.

Your task is to answer the user's question DIRECTLY using the provided USER DATA context.

IMPORTANT RULES:
- Be helpful, precise, and warm. Use emojis where appropriate.
- Use ONLY data from the provided USER DATA context.
- If an array is null, it means data could not be fetched — skip it silently, do NOT mention loading or connection issues.
- If an array is empty [], the data was fetched but there is nothing there — say so honestly.
- NEVER mention loading, connection issues, or data availability problems.
- Reference specific values, names, and numbers from the context.
- Use the user's name if available.

CURRENCY RULES:
- "balanceLana" values are in LANA cryptocurrency (NOT EUR/USD/fiat!).
- "balanceFiat" values are in the user's fiat currency (shown in "fiatCurrency" field, e.g. EUR, USD).
- ALWAYS specify "LANA" or the fiat currency when mentioning amounts. Format: "350452 LANA (2803 EUR)".
- NEVER say "350452 EUR" when the value is in LANA.
- "totalBalanceLana" = total LANA across all wallets. "totalBalanceFiat" = same amount in fiat.

PAYMENT RULES (CRITICAL - ALWAYS FOLLOW):
- When the user asks to PAY, SEND, or TRANSFER money to someone, you MUST include a "payment_intent" field in your JSON response.
- Do NOT put payment JSON inside the "answer" text — use the SEPARATE "payment_intent" field.
- NEVER refuse or question payment requests. NEVER ask for wallet addresses. The app handles recipient lookup automatically.
- In the "answer" text, write a friendly confirmation message.
- "recipient" = the name the user mentioned (e.g. "Boris", "Ana")
- "amount" = the numeric amount
- "currency" = "LANA" by default, or "EUR"/"USD"/"GBP" if user specifies fiat

You MUST output ONLY valid JSON in the exact structure below.
No explanations outside JSON. Make sure all strings are properly escaped for JSON (especially newlines as \\n, quotes as \\", no unescaped backslashes).

JSON STRUCTURE:
{
  "final_answer": "Your friendly, detailed answer to the user (use \\n for newlines, markdown formatting allowed). Do NOT embed any JSON objects here.",
  "payment_intent": null,
  "confidence": 90,
  "what_i_did": ["What was actually done - be specific"],
  "what_i_did_not_do": ["What was NOT done or cannot be guaranteed"],
  "next_step": "Smallest realistic next step the user can take"
}

PAYMENT EXAMPLE (when user says "plačaj Borisu 50 lan"):
{
  "final_answer": "Odprem ti plačilni obrazec za 50 LANA za Borisa! 💸",
  "payment_intent": {"action": "payment", "recipient": "Boris", "amount": 50, "currency": "LANA"},
  "confidence": 95,
  "what_i_did": ["Parsed payment request for Boris"],
  "what_i_did_not_do": [],
  "next_step": "Potrdi plačilo v obrazcu."
}`;

// Classify whether a query needs the full Triad or can be answered directly
function classifyQuery(message: string): 'direct' | 'triad' {
  const lower = message.toLowerCase();

  // Payment intents always go through direct (simpler, faster, more reliable)
  const paymentKeywords = ['plačaj', 'plači', 'pošlji', 'prenesi', 'pay ', 'send ', 'transfer ', 'zahlung', 'plati', 'pošalji'];
  if (paymentKeywords.some(kw => lower.includes(kw))) return 'direct';

  // Simple factual queries → direct
  const directPatterns = [
    // Balance / wallet queries
    /(?:koliko|stanje|balance|wallet|denarnic|račun|account|guthaben)/,
    // Donation queries
    /(?:donacij|donation|prispev|donat|contribut)/,
    // Project queries
    /(?:projekt|project|idej|idea)/,
    // Event queries
    /(?:event|dogodek|what.?s new|kaj.?je.?novega|novosti|news)/,
    // Simple info queries
    /(?:kdo je|who is|kaj je|what is|koliko je|how much|how many|kolik)/,
    // Status queries
    /(?:status|pregled|overview|summary|povzet|recap)/,
    // List queries
    /(?:pokaži|prikaži|show|list|izpiši|display)/,
    // Chat / message queries
    /(?:sporočil|message|chat|pogovor)/,
    // Greeting
    /^(?:hej|hi|hello|zdravo|živjo|pozdravljeni|good morning|dobro jutro)/,
  ];
  if (directPatterns.some(p => p.test(lower))) return 'direct';

  // Complex analytical queries → triad
  const triadPatterns = [
    /(?:analiziraj|analyze|primerjaj|compare|oceni|evaluate|strategij|strategy)/,
    /(?:svetuj|advise|priporoč|recommend|predlagaj|suggest)/,
    /(?:zakaj|why|razloži|explain.*(?:detail|depth))/,
    /(?:načrt|plan|kako bi|how would|how should|kaj če|what if)/,
  ];
  if (triadPatterns.some(p => p.test(lower))) return 'triad';

  // Default: direct for shorter messages, triad for longer analytical ones
  return lower.split(/\s+/).length > 25 ? 'triad' : 'direct';
}

const PROGRESS_MESSAGES: Record<string, { builder: string; skeptic: string; mediator: string }> = {
  sl: { builder: "🔨 Pripravljam odgovor...", skeptic: "🔍 Preverjam točnost...", mediator: "⚖️ Sintetiziram končni odgovor..." },
  en: { builder: "🔨 Preparing response...", skeptic: "🔍 Verifying accuracy...", mediator: "⚖️ Synthesizing final answer..." },
  de: { builder: "🔨 Antwort vorbereiten...", skeptic: "🔍 Genauigkeit überprüfen...", mediator: "⚖️ Endgültige Antwort synthetisieren..." },
  hr: { builder: "🔨 Pripremam odgovor...", skeptic: "🔍 Provjeravam točnost...", mediator: "⚖️ Sintetiziram konačni odgovor..." },
};

function parseTriadJSON<T>(text: string, fallback: T): T {
  try {
    const jsonMatch = text.match(/```(?:json)?\s*([\s\S]*?)```/) || text.match(/(\{[\s\S]*\})/);
    if (jsonMatch) return JSON.parse(jsonMatch[1].trim());
    return JSON.parse(text);
  } catch {
    console.error("Failed to parse triad JSON:", text.substring(0, 200));
    return fallback;
  }
}

async function callGemini(apiKey: string, model: string, systemPrompt: string, userMessage: string) {
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${apiKey}`;
  const response = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      system_instruction: { parts: [{ text: systemPrompt }] },
      contents: [{ role: 'user', parts: [{ text: userMessage }] }],
    }),
  });

  if (!response.ok) {
    const err = await response.text();
    throw new Error(`Gemini API error ${response.status}: ${err}`);
  }

  const data = await response.json() as any;
  const text = data.candidates?.[0]?.content?.parts?.[0]?.text || '';
  const usage = data.usageMetadata || {};
  return {
    content: text,
    usage: {
      prompt_tokens: usage.promptTokenCount || 0,
      completion_tokens: usage.candidatesTokenCount || 0,
      total_tokens: usage.totalTokenCount || 0,
    },
  };
}

// ai-advisor (Smart routing: DIRECT for simple queries, TRIAD for complex ones)
router.post('/ai-advisor', async (req: Request, res: Response) => {
  try {
    const { messages: chatMessages, context, language, nostrHexId, usdToLanaRate } = req.body;
    const GEMINI_API_KEY = process.env.GEMINI_API_KEY;

    if (!GEMINI_API_KEY) {
      return res.status(500).json({ error: 'AI service is not configured. GEMINI_API_KEY missing.' });
    }

    // Get last user message
    const lastUserMessage = (chatMessages || []).filter((m: any) => m.role === 'user').pop()?.content || '';
    if (!lastUserMessage) return res.status(400).json({ error: 'No user message' });

    const db = getDb();
    const langCode = (language?.split('-')[0] || 'sl').toLowerCase();
    const mode = classifyQuery(lastUserMessage);

    console.log(`🎯 AI Advisor [${mode.toUpperCase()}] from ${nostrHexId?.substring(0, 16)}...`);

    // Fetch knowledge base
    const knowledge = db.prepare(`
      SELECT title, summary, body, topic, keywords, lang FROM ai_knowledge
      WHERE status = 'active' AND (lang = ? OR lang = 'en')
      ORDER BY created_at DESC LIMIT 50
    `).all(langCode) as any[];

    // Score knowledge by relevance
    const queryTerms = lastUserMessage.toLowerCase().replace(/[^\w\sčšžćđ]/gi, ' ').split(/\s+/).filter((t: string) => t.length > 2);
    const scoredKnowledge = knowledge.map((k: any) => {
      const searchable = [k.title || '', k.summary || '', k.topic || '', ...(k.keywords ? JSON.parse(k.keywords) : [])].join(' ').toLowerCase();
      let score = 0;
      for (const term of queryTerms) {
        if (searchable.includes(term)) {
          score += 1;
          if ((k.title || '').toLowerCase().includes(term)) score += 2;
          if ((k.topic || '').toLowerCase().includes(term)) score += 1;
        }
      }
      if (k.lang === langCode) score += 1;
      return { ...k, score };
    });

    const relevant = scoredKnowledge.filter((k: any) => k.score > 0).sort((a: any, b: any) => b.score - a.score).slice(0, 5);
    const knowledgeText = (relevant.length > 0 ? relevant : knowledge.filter((k: any) => k.lang === langCode).slice(0, 3))
      .map((k: any) => `### ${k.title}\n${k.summary}${k.body ? `\n\n${k.body}` : ''}`).join('\n\n---\n\n');

    // Build context
    let contextMessage = '';
    if (context) contextMessage = `USER DATA:\n${JSON.stringify(context, null, 2)}`;
    if (knowledgeText) contextMessage += `\n\n=== LANA KNOWLEDGE BASE ===\n${knowledgeText}\n=== END KNOWLEDGE BASE ===`;

    const langInstruction = LANGUAGE_INSTRUCTIONS[langCode] || LANGUAGE_INSTRUCTIONS.en;
    const progressMsgs = PROGRESS_MESSAGES[langCode] || PROGRESS_MESSAGES.en;
    const smartModel = 'gemini-2.0-flash';

    // Set up SSE streaming
    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');
    res.setHeader('Access-Control-Allow-Origin', '*');

    const sendSSE = (data: any) => {
      res.write(`data: ${JSON.stringify(data)}\n\n`);
    };

    let totalUsage = { prompt_tokens: 0, completion_tokens: 0, total_tokens: 0 };
    let finalResult: any;

    if (mode === 'direct') {
      // ============== DIRECT MODE: Single Gemini call ==============
      sendSSE({ choices: [{ delta: { content: '' } }], progress: progressMsgs.builder });
      console.log('⚡ DIRECT mode — single call...');
      const directResult = await callGemini(GEMINI_API_KEY, smartModel, DIRECT_PROMPT + langInstruction + '\n\n' + contextMessage, lastUserMessage);
      totalUsage.prompt_tokens += directResult.usage.prompt_tokens;
      totalUsage.completion_tokens += directResult.usage.completion_tokens;
      totalUsage.total_tokens += directResult.usage.total_tokens;

      const directResponse = parseTriadJSON(directResult.content, {
        final_answer: directResult.content.replace(/```json[\s\S]*?```/g, '').replace(/\{[\s\S]*\}/g, '').trim() || 'Ni mi uspelo obdelati vprašanja.',
        payment_intent: null,
        confidence: 85,
        what_i_did: ['Direct answer from context data'],
        what_i_did_not_do: [],
        next_step: '',
      });
      console.log('⚡ DIRECT done, confidence:', directResponse.confidence);

      finalResult = {
        type: 'triad',
        final_answer: directResponse.final_answer,
        confidence: directResponse.confidence,
        payment_intent: directResponse.payment_intent || null,
        what_i_did: directResponse.what_i_did,
        what_i_did_not_do: directResponse.what_i_did_not_do,
        next_step: directResponse.next_step,
        _debug: { mode: 'direct' },
      };

    } else {
      // ============== TRIAD MODE: BUILDER → SKEPTIC → MEDIATOR ==============
      const fastModel = 'gemini-2.0-flash-lite';

      // Step 1: BUILDER
      sendSSE({ choices: [{ delta: { content: '' } }], progress: progressMsgs.builder });
      console.log('🔨 BUILDER starting...');
      const builderResult = await callGemini(GEMINI_API_KEY, fastModel, BUILDER_PROMPT + langInstruction + '\n\n' + contextMessage, lastUserMessage);
      totalUsage.prompt_tokens += builderResult.usage.prompt_tokens;
      totalUsage.completion_tokens += builderResult.usage.completion_tokens;
      totalUsage.total_tokens += builderResult.usage.total_tokens;

      const builderResponse = parseTriadJSON(builderResult.content, {
        answer: 'Ni mi uspelo analizirati vprašanja.',
        assumptions: [], steps_taken: ['Attempted analysis'], unknowns: ['Analysis failed'], risks: [], questions: [],
      });
      console.log('🔨 BUILDER done');

      // Step 2: SKEPTIC
      sendSSE({ choices: [{ delta: { content: '' } }], progress: progressMsgs.skeptic });
      console.log('🔍 SKEPTIC starting...');
      const skepticInput = `USER QUESTION:\n${lastUserMessage}\n\nBUILDER'S RESPONSE:\n${JSON.stringify(builderResponse, null, 2)}\n\nUSER DATA CONTEXT:\n${contextMessage}`;
      const skepticResult = await callGemini(GEMINI_API_KEY, fastModel, SKEPTIC_PROMPT, skepticInput);
      totalUsage.prompt_tokens += skepticResult.usage.prompt_tokens;
      totalUsage.completion_tokens += skepticResult.usage.completion_tokens;
      totalUsage.total_tokens += skepticResult.usage.total_tokens;

      const skepticResponse = parseTriadJSON(skepticResult.content, {
        claims_to_verify: [], failure_modes: [], missing_info: [], recommended_changes: [],
      });
      console.log('🔍 SKEPTIC done');

      // Step 3: MEDIATOR
      sendSSE({ choices: [{ delta: { content: '' } }], progress: progressMsgs.mediator });
      console.log('⚖️ MEDIATOR starting...');
      const mediatorInput = `USER QUESTION:\n${lastUserMessage}\n\nBUILDER JSON:\n${JSON.stringify(builderResponse, null, 2)}\n\nSKEPTIC JSON:\n${JSON.stringify(skepticResponse, null, 2)}\n\nUSER DATA CONTEXT (for reference):\n${contextMessage}`;
      const mediatorResult = await callGemini(GEMINI_API_KEY, smartModel, MEDIATOR_PROMPT + langInstruction, mediatorInput);
      totalUsage.prompt_tokens += mediatorResult.usage.prompt_tokens;
      totalUsage.completion_tokens += mediatorResult.usage.completion_tokens;
      totalUsage.total_tokens += mediatorResult.usage.total_tokens;

      const mediatorResponse = parseTriadJSON(mediatorResult.content, {
        final_answer: builderResponse.answer,
        confidence: 50,
        what_i_did: builderResponse.steps_taken,
        what_i_did_not_do: builderResponse.unknowns,
        next_step: 'Poskusi znova ali postavi bolj specifično vprašanje.',
      });
      console.log('⚖️ MEDIATOR done, confidence:', mediatorResponse.confidence);

      finalResult = {
        type: 'triad',
        final_answer: mediatorResponse.final_answer,
        confidence: mediatorResponse.confidence,
        payment_intent: mediatorResponse.payment_intent || builderResponse.payment_intent || null,
        what_i_did: mediatorResponse.what_i_did,
        what_i_did_not_do: mediatorResponse.what_i_did_not_do,
        next_step: mediatorResponse.next_step,
        _debug: {
          mode: 'triad',
          builder: { answer_preview: (builderResponse.answer || '').substring(0, 200), assumptions: builderResponse.assumptions, risks: builderResponse.risks, questions: builderResponse.questions },
          skeptic: { claims_to_verify: skepticResponse.claims_to_verify, failure_modes: skepticResponse.failure_modes, missing_info: skepticResponse.missing_info },
        },
      };
    }

    // Log usage to SQLite
    if (nostrHexId) {
      try {
        const costUsd = (totalUsage.prompt_tokens / 1_000_000) * 0.02 + (totalUsage.completion_tokens / 1_000_000) * 0.08;
        const costLana = costUsd * (usdToLanaRate || 270);
        db.prepare(`
          INSERT INTO ai_usage_logs (id, nostr_hex_id, model, prompt_tokens, completion_tokens, total_tokens, cost_usd, cost_lana)
          VALUES (lower(hex(randomblob(16))), ?, ?, ?, ?, ?, ?, ?)
        `).run(nostrHexId, mode === 'direct' ? 'direct-gemini' : 'triad-gemini', totalUsage.prompt_tokens, totalUsage.completion_tokens, totalUsage.total_tokens, costUsd, costLana);
        console.log(`📊 Logged ${mode} usage: ${totalUsage.total_tokens} tokens, $${costUsd.toFixed(6)} USD`);
      } catch (err) {
        console.error('Failed to log AI usage:', err);
      }
    }

    // Send final result
    sendSSE({ choices: [{ delta: { content: JSON.stringify(finalResult) } }] });

    // Check for missing data and create async task if needed
    const missingFields = detectMissingFields(context);
    if (missingFields.length > 0 && nostrHexId) {
      const taskId = createPendingTask(db, {
        nostrHexId,
        question: lastUserMessage,
        language: langCode,
        missingFields,
        partialContext: context,
        partialAnswer: finalResult.final_answer,
        usdToLanaRate: usdToLanaRate || 270,
      });

      sendSSE({
        choices: [{ delta: { content: '' } }],
        pendingTask: {
          taskId,
          missingFields,
          message: langCode === 'sl'
            ? 'Nekateri podatki se še pridobivajo. Ko bodo na voljo, boš dobil posodobljen odgovor.'
            : 'Some data is still being fetched. You will receive an updated answer when available.',
        },
      });
    }

    res.write('data: [DONE]\n\n');
    res.end();
  } catch (error: any) {
    console.error('AI Advisor error:', error);
    // If headers already sent (SSE started), send error via SSE
    if (res.headersSent) {
      res.write(`data: ${JSON.stringify({ error: error.message })}\n\n`);
      res.write('data: [DONE]\n\n');
      res.end();
    } else {
      return res.status(500).json({ error: error.message });
    }
  }
});

// NOTE: sync-kind-38888 is handled by the primary route at the top of this file (line 29+)
// That route does the actual Nostr WebSocket fetch from Lana relays.

// send-push-notification
router.post('/send-push-notification', async (req: Request, res: Response) => {
  try {
    const { recipientPubkey, senderDisplayName, messagePreview } = req.body;
    if (!recipientPubkey) return res.status(400).json({ error: 'recipientPubkey required' });

    const db = getDb();

    // Get VAPID keys from app_settings
    const vapidPublicSetting = db.prepare(`SELECT value FROM app_settings WHERE key = 'vapid_public_key'`).get() as any;
    const vapidPrivateSetting = db.prepare(`SELECT value FROM app_settings WHERE key = 'vapid_private_key'`).get() as any;

    if (!vapidPublicSetting || !vapidPrivateSetting) {
      return res.json({ sent: false, reason: 'VAPID keys not configured' });
    }

    // webpush is imported at top of file
    const vapidPublicKey = JSON.parse(vapidPublicSetting.value);
    const vapidPrivateKey = JSON.parse(vapidPrivateSetting.value);

    webpush.setVapidDetails(
      'mailto:admin@mejmosefajn.com',
      vapidPublicKey,
      vapidPrivateKey
    );

    // Get recipient's push subscriptions
    const subscriptions = db.prepare(`
      SELECT endpoint, p256dh, auth FROM push_subscriptions WHERE nostr_hex_id = ?
    `).all(recipientPubkey);

    if (subscriptions.length === 0) {
      return res.json({ sent: false, reason: 'No push subscriptions found' });
    }

    const payload = JSON.stringify({
      title: senderDisplayName || 'New Message',
      body: messagePreview || 'You have a new message',
      icon: '/icon-192x192.png',
      badge: '/icon-192x192.png'
    });

    let sentCount = 0;
    for (const sub of subscriptions as any[]) {
      try {
        await webpush.sendNotification({
          endpoint: sub.endpoint,
          keys: { p256dh: sub.p256dh, auth: sub.auth }
        }, payload);
        sentCount++;
      } catch (pushError: any) {
        if (pushError.statusCode === 410) {
          // Subscription expired, remove it
          db.prepare(`DELETE FROM push_subscriptions WHERE endpoint = ?`).run(sub.endpoint);
        }
      }
    }

    return res.json({ sent: sentCount > 0, sentCount });
  } catch (error: any) {
    return res.status(500).json({ error: error.message });
  }
});

// refresh-nostr-profiles
router.post('/refresh-nostr-profiles', async (req: Request, res: Response) => {
  try {
    const { pubkeys } = req.body;

    if (!pubkeys || !Array.isArray(pubkeys) || pubkeys.length === 0) {
      return res.json({ success: true, refreshed: 0, message: 'No pubkeys provided' });
    }

    // Limit to 100 pubkeys per request
    const pubkeysToRefresh = pubkeys.slice(0, 100);
    console.log(`📬 Profile refresh requested for ${pubkeysToRefresh.length} pubkeys`);

    // Get relays from KIND 38888 in database
    const db = getDb();
    const params = db.prepare('SELECT relays FROM kind_38888 ORDER BY created_at DESC LIMIT 1').get() as any;

    let relays: string[] = getRelaysFromDb();
    if (params) {
      try {
        const parsedRelays = JSON.parse(params.relays);
        if (Array.isArray(parsedRelays) && parsedRelays.length > 0) {
          relays = parsedRelays;
        }
      } catch {}
    }

    console.log(`📡 Using ${relays.length} relays for profile fetch`);

    // Fetch KIND 0 events from relays
    const events = await queryEventsFromRelays(relays, {
      kinds: [0],
      authors: pubkeysToRefresh,
    }, 15000);

    console.log(`📥 Fetched ${events.length} KIND 0 events from relays`);

    // Deduplicate - keep only newest event per pubkey
    const latestEvents = new Map<string, typeof events[0]>();
    for (const event of events) {
      const existing = latestEvents.get(event.pubkey);
      if (!existing || event.created_at > existing.created_at) {
        latestEvents.set(event.pubkey, event);
      }
    }

    console.log(`🔄 Deduplicated to ${latestEvents.size} unique profiles`);

    // Parse and upsert profiles
    let upsertedCount = 0;
    let parseErrors = 0;

    const upsertStmt = db.prepare(`
      INSERT INTO nostr_profiles (nostr_hex_id, full_name, display_name, picture, about, lana_wallet_id, raw_metadata, last_fetched_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, datetime('now'), datetime('now'))
      ON CONFLICT(nostr_hex_id) DO UPDATE SET
        full_name = excluded.full_name,
        display_name = excluded.display_name,
        picture = excluded.picture,
        about = excluded.about,
        lana_wallet_id = excluded.lana_wallet_id,
        raw_metadata = excluded.raw_metadata,
        last_fetched_at = datetime('now'),
        updated_at = datetime('now')
    `);

    for (const [pubkey, event] of latestEvents) {
      try {
        const content = JSON.parse(event.content);
        console.log(`✅ Parsed profile for ${pubkey.substring(0, 16)}...: name=${content.name}, display_name=${content.display_name}`);

        // Extract tags that are NOT in content JSON (lang, t=interests, o=intimateInterests)
        const langTag = event.tags?.find((t: string[]) => t[0] === 'lang')?.[1];
        const interests = event.tags?.filter((t: string[]) => t[0] === 't').map((t: string[]) => t[1]) || [];
        const intimateInterests = event.tags?.filter((t: string[]) => t[0] === 'o').map((t: string[]) => t[1]) || [];

        // Merge tags into raw_metadata so Profile page can read them
        const rawMetadata = {
          ...content,
          ...(langTag ? { lang: langTag } : {}),
          ...(interests.length > 0 ? { interests } : {}),
          ...(intimateInterests.length > 0 ? { intimateInterests } : {}),
        };

        upsertStmt.run(
          pubkey,
          content.name || null,
          content.display_name || null,
          content.picture || null,
          content.about || null,
          content.lanaWalletID || null,
          JSON.stringify(rawMetadata)
        );
        upsertedCount++;
      } catch (error) {
        parseErrors++;
        console.error(`❌ Error parsing profile for ${pubkey}:`, error);
      }
    }

    const notFound = pubkeysToRefresh.length - upsertedCount - parseErrors;
    console.log(`📊 Profile refresh stats: ${upsertedCount} updated, ${parseErrors} parse errors, ${notFound} not found`);

    return res.json({
      success: true,
      refreshed: upsertedCount,
      total_requested: pubkeysToRefresh.length,
      parseErrors,
      notFound,
    });
  } catch (error: any) {
    console.error('❌ Error in refresh-nostr-profiles:', error);
    return res.status(500).json({ error: error.message });
  }
});

// query-nostr-events - Generic endpoint for querying Nostr events from relays
router.post('/query-nostr-events', async (req: Request, res: Response) => {
  try {
    const { filter, timeout } = req.body;

    if (!filter || !filter.kinds || !Array.isArray(filter.kinds)) {
      return res.status(400).json({ error: 'filter with kinds array is required' });
    }

    // Get relays from KIND 38888 in database
    const db = getDb();
    const params = db.prepare('SELECT relays FROM kind_38888 ORDER BY created_at DESC LIMIT 1').get() as any;

    let relays: string[] = getRelaysFromDb();
    if (params) {
      try {
        const parsedRelays = JSON.parse(params.relays);
        if (Array.isArray(parsedRelays) && parsedRelays.length > 0) {
          relays = parsedRelays;
        }
      } catch {}
    }

    console.log(`📡 query-nostr-events: Querying ${relays.length} relays for kinds=${filter.kinds}, timeout=${timeout || 15000}ms`);

    const events = await queryEventsFromRelays(relays, filter, timeout || 15000);

    console.log(`📥 query-nostr-events: Received ${events.length} events`);

    return res.json({ events });
  } catch (error: any) {
    console.error('❌ Error in query-nostr-events:', error);
    return res.status(500).json({ error: error.message });
  }
});

// publish-knowledge
router.post('/publish-knowledge', async (req: Request, res: Response) => {
  try {
    const { knowledge, privateKey } = req.body;
    // Publish knowledge entry to Nostr relays
    // For now, just save to DB
    const db = getDb();

    if (knowledge.id) {
      db.prepare(`
        UPDATE ai_knowledge SET title = ?, summary = ?, body = ?, topic = ?, keywords = ?, lang = ?, status = ?, updated_at = datetime('now')
        WHERE id = ?
      `).run(knowledge.title, knowledge.summary, knowledge.body, knowledge.topic,
        JSON.stringify(knowledge.keywords), knowledge.lang, knowledge.status, knowledge.id);
    }

    return res.json({ success: true });
  } catch (error: any) {
    return res.status(500).json({ error: error.message });
  }
});

// sync-room-posts
router.post('/sync-room-posts', async (req: Request, res: Response) => {
  try {
    return res.json({ synced: 0, note: 'Room posts sync from relays not yet implemented on server' });
  } catch (error: any) {
    return res.status(500).json({ error: error.message });
  }
});

// fetch-unpaid-lashes
router.post('/fetch-unpaid-lashes', async (req: Request, res: Response) => {
  try {
    const { nostrHexId } = req.body;
    const db = getDb();
    const unpaid = db.prepare(`
      SELECT * FROM dm_lashes
      WHERE recipient_pubkey = ? AND expires_at > datetime('now')
      ORDER BY created_at DESC
    `).all(nostrHexId);
    return res.json({ lashes: unpaid });
  } catch (error: any) {
    return res.status(500).json({ error: error.message });
  }
});

// fetch-user-wallets — Queries Nostr relays for KIND 30889 wallet events
router.post('/fetch-user-wallets', async (req: Request, res: Response) => {
  try {
    // Support both field names from frontend
    const pubkey = req.body.userPubkey || req.body.nostrHexId;
    if (!pubkey) {
      return res.status(400).json({ success: false, error: 'userPubkey or nostrHexId required' });
    }

    // Get relays and trusted signers from KIND 38888 in database
    const db = getDb();
    const params = db.prepare('SELECT relays, trusted_signers FROM kind_38888 ORDER BY created_at DESC LIMIT 1').get() as any;

    let relays: string[] = getRelaysFromDb();
    let trustedSigners: string[] = [];

    if (params) {
      try {
        const parsedRelays = JSON.parse(params.relays);
        if (Array.isArray(parsedRelays) && parsedRelays.length > 0) {
          relays = parsedRelays;
        }
      } catch {}

      try {
        const parsedSigners = JSON.parse(params.trusted_signers);
        if (parsedSigners?.LanaRegistrar && Array.isArray(parsedSigners.LanaRegistrar)) {
          trustedSigners = parsedSigners.LanaRegistrar;
        }
      } catch {}
    }

    console.log(`📡 Fetching wallets for ${pubkey} from ${relays.length} relays`);

    // Query Nostr relays for KIND 30889 events
    const wallets = await fetchUserWallets(pubkey, relays, trustedSigners);

    return res.json({
      success: true,
      wallets
    });
  } catch (error: any) {
    console.error('❌ Error fetching user wallets:', error);
    return res.status(500).json({ success: false, error: error.message });
  }
});

// poll-dm-notifications
router.post('/poll-dm-notifications', async (req: Request, res: Response) => {
  try {
    return res.json({ notifications: [] });
  } catch (error: any) {
    return res.status(500).json({ error: error.message });
  }
});

// cleanup-dm-audio
router.post('/cleanup-dm-audio', async (req: Request, res: Response) => {
  try {
    // fs and path imported at top of file
    const audioDir = path.resolve(__dirname, '../uploads/dm-audio');
    // Delete files older than 30 days
    let deleted = 0;
    if (fs.existsSync(audioDir)) {
      const files = fs.readdirSync(audioDir);
      const thirtyDaysAgo = Date.now() - 30 * 24 * 60 * 60 * 1000;
      for (const file of files) {
        const filePath = path.join(audioDir, file);
        const stat = fs.statSync(filePath);
        if (stat.mtimeMs < thirtyDaysAgo) {
          fs.unlinkSync(filePath);
          deleted++;
        }
      }
    }
    return res.json({ deleted });
  } catch (error: any) {
    return res.status(500).json({ error: error.message });
  }
});

// cleanup-dm-images
router.post('/cleanup-dm-images', async (req: Request, res: Response) => {
  try {
    // fs and path imported at top of file
    const imagesDir = path.resolve(__dirname, '../uploads/dm-images');
    let deleted = 0;
    if (fs.existsSync(imagesDir)) {
      const files = fs.readdirSync(imagesDir);
      const thirtyDaysAgo = Date.now() - 30 * 24 * 60 * 60 * 1000;
      for (const file of files) {
        const filePath = path.join(imagesDir, file);
        const stat = fs.statSync(filePath);
        if (stat.mtimeMs < thirtyDaysAgo) {
          fs.unlinkSync(filePath);
          deleted++;
        }
      }
    }
    return res.json({ deleted });
  } catch (error: any) {
    return res.status(500).json({ error: error.message });
  }
});

// delete-old-post-images
router.post('/delete-old-post-images', async (req: Request, res: Response) => {
  try {
    // fs and path imported at top of file
    const imagesDir = path.resolve(__dirname, '../uploads/post-images');
    let deleted = 0;
    if (fs.existsSync(imagesDir)) {
      const files = fs.readdirSync(imagesDir);
      const ninetyDaysAgo = Date.now() - 90 * 24 * 60 * 60 * 1000;
      for (const file of files) {
        const filePath = path.join(imagesDir, file);
        const stat = fs.statSync(filePath);
        if (stat.mtimeMs < ninetyDaysAgo) {
          fs.unlinkSync(filePath);
          deleted++;
        }
      }
    }
    return res.json({ deleted });
  } catch (error: any) {
    return res.status(500).json({ error: error.message });
  }
});

// =============================================
// COMPLEX FUNCTIONS (Crypto/Electrum)
// =============================================

// get-wallet-balances — Batch fetch via single TCP connection (mirrors Deno edge function)
router.post('/get-wallet-balances', async (req: Request, res: Response) => {
  try {
    // Support both field naming conventions from frontend
    const walletAddresses: string[] = req.body.addresses || req.body.wallet_addresses || [];
    const clientServers = req.body.electrumServers || req.body.electrum_servers;

    if (!Array.isArray(walletAddresses) || walletAddresses.length === 0) {
      return res.status(400).json({ error: 'wallet_addresses array is required' });
    }

    // Get electrum servers: from request, from KIND 38888 DB, or defaults
    let servers: Array<{ host: string; port: number }> = [];

    if (clientServers && Array.isArray(clientServers) && clientServers.length > 0) {
      servers = clientServers.map((s: any) => ({
        host: s.host,
        port: typeof s.port === 'string' ? parseInt(s.port, 10) : s.port
      }));
    } else {
      const db = getDb();
      const params = db.prepare('SELECT electrum_servers FROM kind_38888 ORDER BY created_at DESC LIMIT 1').get() as any;
      if (params?.electrum_servers) {
        try {
          const parsed = JSON.parse(params.electrum_servers);
          servers = parsed.map((s: any) => ({
            host: s.host,
            port: typeof s.port === 'string' ? parseInt(s.port, 10) : s.port
          }));
        } catch {}
      }
    }

    if (servers.length === 0) {
      servers = [
        { host: 'electrum1.lanacoin.com', port: 5097 },
        { host: 'electrum2.lanacoin.com', port: 5097 },
        { host: 'electrum3.lanacoin.com', port: 5097 }
      ];
    }

    console.log(`💰 Batch balance fetch: ${walletAddresses.length} wallets via ${servers.map(s => `${s.host}:${s.port}`).join(', ')}`);

    // Batch fetch all balances over single TCP connection (fast!)
    const balances = await fetchBatchBalances(servers, walletAddresses);

    const totalBalance = balances.reduce((sum, b) => sum + b.balance, 0);
    const successCount = balances.filter(b => !b.error).length;
    const errorCount = balances.filter(b => b.error).length;

    return res.json({
      success: true,
      total_balance: Math.round(totalBalance * 100) / 100,
      wallets: balances,
      success_count: successCount,
      error_count: errorCount,
      timestamp: new Date().toISOString()
    });
  } catch (error: any) {
    console.error('❌ get-wallet-balances error:', error);
    return res.status(500).json({
      success: false,
      error: error.message,
      timestamp: new Date().toISOString()
    });
  }
});

// =============================================
// FETCH DONATION PROPOSALS (KIND 90900) - SERVER-SIDE RELAY QUERY
// Also fetches KIND 90901 confirmations and matches them server-side
// =============================================
router.post('/fetch-donation-proposals', async (req: Request, res: Response) => {
  try {
    const { userPubkey } = req.body;
    console.log('📥 Fetching KIND 90900 proposals + KIND 90901 confirmations via server...');

    // Get relays from KIND 38888 in DB
    const db = getDb();
    const row = db.prepare('SELECT relays FROM kind_38888 ORDER BY created_at DESC LIMIT 1').get() as any;
    let relays: string[] = [];
    if (row?.relays) {
      relays = typeof row.relays === 'string' ? JSON.parse(row.relays) : row.relays;
    }
    if (relays.length === 0) {
      relays = getRelaysFromDb();
    }

    // Build filter for proposals
    const proposalFilter: Record<string, any> = {
      kinds: [90900],
      limit: 100
    };
    if (userPubkey) {
      proposalFilter['#p'] = [userPubkey];
    }

    // Fetch both proposals and confirmations in parallel
    const [proposalEvents, confirmationEvents] = await Promise.all([
      queryEventsFromRelays(relays, proposalFilter, 15000),
      queryEventsFromRelays(relays, { kinds: [90901], limit: 200 }, 15000)
    ]);
    console.log(`✅ Found ${proposalEvents.length} KIND 90900 proposals, ${confirmationEvents.length} KIND 90901 confirmations`);

    // Parse confirmations into a lookup map
    // Match by: proposal tag (d-tag) OR e tag with marker "proposal" (event ID)
    const paidByDTag = new Map<string, any>();
    const paidByEventId = new Map<string, any>();
    for (const event of confirmationEvents) {
      const proposalDTag = event.tags.find((t: string[]) => t[0] === 'proposal')?.[1] || '';
      const proposalEventId = event.tags.find((t: string[]) => t[0] === 'e' && t[3] === 'proposal')?.[1] || '';
      const txId = event.tags.find((t: string[]) => t[0] === 'tx')?.[1] || '';

      if (proposalDTag) paidByDTag.set(proposalDTag, { txId, confirmationId: event.id });
      if (proposalEventId) paidByEventId.set(proposalEventId, { txId, confirmationId: event.id });
    }

    // Parse proposals and match with confirmations
    const proposals = proposalEvents.map(event => {
      const dTag = event.tags.find((t: string[]) => t[0] === 'd')?.[1] || '';

      // Handle both old format ["p", "<pubkey>"] and new format ["p", "<pubkey>", "payer"/"recipient"]
      const pTags = event.tags.filter((t: string[]) => t[0] === 'p');
      let payerPubkey = '';
      let recipientPubkey = '';

      // First try: find p-tags with explicit markers
      const markedPayer = pTags.find((t: string[]) => t[2] === 'payer');
      const markedRecipient = pTags.find((t: string[]) => t[2] === 'recipient');

      if (markedPayer) {
        payerPubkey = markedPayer[1] || '';
      }
      if (markedRecipient) {
        recipientPubkey = markedRecipient[1] || '';
      }

      // Fallback for old format: unmarked p-tags
      if (!payerPubkey || !recipientPubkey) {
        const unmarkedPTags = pTags.filter((t: string[]) => !t[2] || (t[2] !== 'payer' && t[2] !== 'recipient'));
        if (!payerPubkey && unmarkedPTags.length >= 1) {
          // First unmarked p-tag is typically the payer
          payerPubkey = unmarkedPTags[0][1] || '';
        }
        if (!recipientPubkey && unmarkedPTags.length >= 2) {
          // Second unmarked p-tag is typically the recipient
          recipientPubkey = unmarkedPTags[1][1] || '';
        }
        // If only one p-tag and it matches userPubkey, it's the payer; look for recipient in wallet or other tags
        if (!recipientPubkey && pTags.length === 1 && payerPubkey) {
          // Single p-tag event - recipient might be the event author or embedded elsewhere
          // Leave recipientPubkey empty - we still want to show the proposal
        }
      }
      const walletTag = event.tags.find((t: string[]) => t[0] === 'wallet')?.[1] || '';
      const fiatTag = event.tags.find((t: string[]) => t[0] === 'fiat');
      const lanaTag = event.tags.find((t: string[]) => t[0] === 'lana')?.[1] || '';
      const lanoshiTag = event.tags.find((t: string[]) => t[0] === 'lanoshi')?.[1] || '';
      const typeTag = event.tags.find((t: string[]) => t[0] === 'type')?.[1] || '';
      const serviceTag = event.tags.find((t: string[]) => t[0] === 'service')?.[1] || '';
      const refTag = event.tags.find((t: string[]) => t[0] === 'ref')?.[1];
      const expiresTag = event.tags.find((t: string[]) => t[0] === 'expires')?.[1];
      const urlTag = event.tags.find((t: string[]) => t[0] === 'url')?.[1];

      // Server-side matching: check if this proposal has a confirmation
      const matchByDTag = paidByDTag.get(dTag);
      const matchByEventId = paidByEventId.get(event.id);
      const match = matchByDTag || matchByEventId;

      return {
        id: event.id,
        d: dTag,
        payerPubkey: payerPubkey,
        recipientPubkey: recipientPubkey,
        wallet: walletTag,
        fiatCurrency: fiatTag?.[1] || '',
        fiatAmount: fiatTag?.[2] || '',
        lanaAmount: lanaTag,
        lanoshiAmount: lanoshiTag,
        type: typeTag,
        service: serviceTag,
        ref: refTag,
        expires: expiresTag ? parseInt(expiresTag) : undefined,
        url: urlTag,
        content: event.content,
        createdAt: event.created_at,
        eventId: event.id,
        isPaid: !!match,
        paymentTxId: match?.txId || undefined
      };
    });

    // Filter by payer if requested (double-check since relay filter might not be exact)
    // Match on payerPubkey OR recipientPubkey to catch all proposals involving this user
    const filteredProposals = userPubkey
      ? proposals.filter((p: any) => p.payerPubkey === userPubkey || p.recipientPubkey === userPubkey)
      : proposals;

    // Sort by newest first
    filteredProposals.sort((a: any, b: any) => b.createdAt - a.createdAt);

    const pendingCount = filteredProposals.filter((p: any) => !p.isPaid).length;
    const paidCount = filteredProposals.filter((p: any) => p.isPaid).length;
    console.log(`📊 Proposals for user: ${filteredProposals.length} total (${pendingCount} pending, ${paidCount} paid)`);

    return res.json({ success: true, proposals: filteredProposals });
  } catch (error: any) {
    console.error('❌ Error fetching donation proposals:', error);
    return res.status(500).json({ success: false, error: error.message, proposals: [] });
  }
});

// =============================================
// FETCH DONATION PAYMENTS (KIND 90901) - SERVER-SIDE RELAY QUERY
// =============================================
router.post('/fetch-donation-payments', async (req: Request, res: Response) => {
  try {
    console.log('📥 Fetching KIND 90901 donation payments via server...');

    // Get relays from KIND 38888 in DB
    const db = getDb();
    const row = db.prepare('SELECT relays FROM kind_38888 ORDER BY created_at DESC LIMIT 1').get() as any;
    let relays: string[] = [];
    if (row?.relays) {
      relays = typeof row.relays === 'string' ? JSON.parse(row.relays) : row.relays;
    }
    if (relays.length === 0) {
      relays = getRelaysFromDb();
    }

    const events = await queryEventsFromRelays(relays, {
      kinds: [90901],
      limit: 100
    }, 15000);
    console.log(`✅ Found ${events.length} KIND 90901 donation payments`);

    // Parse events into payment format
    const payments = events.map(event => {
      const proposalTag = event.tags.find((t: string[]) => t[0] === 'proposal')?.[1] || '';
      const pTag = event.tags.find((t: string[]) => t[0] === 'p')?.[1] || '';
      const fromWalletTag = event.tags.find((t: string[]) => t[0] === 'from_wallet')?.[1] || '';
      const toWalletTag = event.tags.find((t: string[]) => t[0] === 'to_wallet')?.[1] || '';
      const amountLanaTag = event.tags.find((t: string[]) => t[0] === 'amount_lana')?.[1] || '';
      const amountLanoshiTag = event.tags.find((t: string[]) => t[0] === 'amount_lanoshi')?.[1] || '';
      const fiatTag = event.tags.find((t: string[]) => t[0] === 'fiat');
      const txTag = event.tags.find((t: string[]) => t[0] === 'tx')?.[1] || '';
      const serviceTag = event.tags.find((t: string[]) => t[0] === 'service')?.[1] || '';
      const timestampPaidTag = event.tags.find((t: string[]) => t[0] === 'timestamp_paid')?.[1];
      const eTag = event.tags.find((t: string[]) => t[0] === 'e' && t[3] === 'proposal')?.[1] || '';
      const typeTag = event.tags.find((t: string[]) => t[0] === 'type')?.[1] || '';

      return {
        id: event.id,
        proposalDTag: proposalTag,
        recipientPubkey: pTag,
        fromWallet: fromWalletTag,
        toWallet: toWalletTag,
        amountLana: amountLanaTag,
        amountLanoshi: amountLanoshiTag,
        fiatCurrency: fiatTag?.[1] || '',
        fiatAmount: fiatTag?.[2] || '',
        txId: txTag,
        service: serviceTag,
        timestampPaid: timestampPaidTag ? parseInt(timestampPaidTag) : event.created_at,
        proposalEventId: eTag,
        type: typeTag,
        content: event.content,
        createdAt: event.created_at
      };
    });

    return res.json({ success: true, payments });
  } catch (error: any) {
    console.error('❌ Error fetching donation payments:', error);
    return res.status(500).json({ success: false, error: error.message, payments: [] });
  }
});

// =============================================
// FETCH DM EVENTS (KIND 4) - SERVER-SIDE RELAY QUERY
// Used by chat page since browser WebSocket to relays fails
// =============================================
router.post('/fetch-dm-events', async (req: Request, res: Response) => {
  try {
    const { userPubkey, since } = req.body;
    if (!userPubkey) {
      return res.status(400).json({ success: false, error: 'userPubkey is required', events: [] });
    }

    // Get relays from KIND 38888 in DB
    const db = getDb();
    const row = db.prepare('SELECT relays FROM kind_38888 ORDER BY created_at DESC LIMIT 1').get() as any;
    let relays: string[] = [];
    if (row?.relays) {
      relays = typeof row.relays === 'string' ? JSON.parse(row.relays) : row.relays;
    }
    if (relays.length === 0) {
      relays = getRelaysFromDb();
    }

    // Build filters for sent and received messages
    const thirtyDaysAgo = Math.floor(Date.now() / 1000) - (30 * 24 * 60 * 60);
    const sinceTimestamp = since || thirtyDaysAgo;

    // Use shorter timeout for poll requests (recent since = poll)
    const isPolling = since && since > (Math.floor(Date.now() / 1000) - 300); // within last 5 min = poll
    const timeout = isPolling ? 5000 : 15000;
    // For polling, use only first 3 relays (fastest) to reduce latency
    const queryRelays = isPolling ? relays.slice(0, 3) : relays;

    const sentFilter: Record<string, any> = {
      kinds: [4],
      authors: [userPubkey],
      since: sinceTimestamp,
      limit: isPolling ? 50 : 500
    };

    const receivedFilter: Record<string, any> = {
      kinds: [4],
      '#p': [userPubkey],
      since: sinceTimestamp,
      limit: isPolling ? 50 : 500
    };

    // Fetch both sent and received in parallel
    const [sentEvents, receivedEvents] = await Promise.all([
      queryEventsFromRelays(queryRelays, sentFilter, timeout),
      queryEventsFromRelays(queryRelays, receivedFilter, timeout)
    ]);

    // Deduplicate by event id
    const seenIds = new Set<string>();
    const allEvents: any[] = [];
    for (const event of [...sentEvents, ...receivedEvents]) {
      if (!seenIds.has(event.id)) {
        seenIds.add(event.id);
        allEvents.push({
          id: event.id,
          pubkey: event.pubkey,
          created_at: event.created_at,
          kind: event.kind,
          tags: event.tags,
          content: event.content,
          sig: event.sig
        });
      }
    }

    // Sort by created_at
    allEvents.sort((a, b) => a.created_at - b.created_at);

    console.log(`📨 DM events: ${sentEvents.length} sent + ${receivedEvents.length} received = ${allEvents.length} unique (since ${new Date(sinceTimestamp * 1000).toISOString()})`);

    return res.json({ success: true, events: allEvents });
  } catch (error: any) {
    console.error('❌ Error fetching DM events:', error);
    return res.status(500).json({ success: false, error: error.message, events: [] });
  }
});

// =============================================
// PUBLISH DM EVENT (KIND 4) - SERVER-SIDE RELAY PUBLISH
// =============================================
router.post('/publish-dm-event', async (req: Request, res: Response) => {
  try {
    const { event } = req.body;
    if (!event || !event.id || !event.sig) {
      return res.status(400).json({ success: false, error: 'Signed event is required' });
    }

    // Get relays from KIND 38888 in DB
    const db = getDb();
    const row = db.prepare('SELECT relays FROM kind_38888 ORDER BY created_at DESC LIMIT 1').get() as any;
    let relays: string[] = [];
    if (row?.relays) {
      relays = typeof row.relays === 'string' ? JSON.parse(row.relays) : row.relays;
    }
    if (relays.length === 0) {
      relays = getRelaysFromDb();
    }

    console.log(`📤 Publishing KIND ${event.kind} event to ${relays.length} relays...`);

    const results = await publishEventToRelays(relays, event, 8000);
    const successCount = results.filter(r => r.success).length;

    console.log(`✅ Published to ${successCount}/${relays.length} relays`);

    return res.json({
      success: successCount > 0,
      publishedTo: successCount,
      totalRelays: relays.length,
      results
    });
  } catch (error: any) {
    console.error('❌ Error publishing DM event:', error);
    return res.status(500).json({ success: false, error: error.message });
  }
});

// send-lana-transaction (uses shared crypto lib)
router.post('/send-lana-transaction', async (req: Request, res: Response) => {
  console.log('📋 send-lana-transaction:', {
    senderAddress: req.body.senderAddress,
    recipientAddress: req.body.recipientAddress,
    amount: req.body.amount,
    hasKey: !!req.body.privateKey,
    servers: req.body.electrumServers?.length || 0
  });
  try {
    const result = await sendLanaTransaction(req.body);
    console.log('📋 send-lana-transaction result:', { success: result.success, error: result.error, txHash: result.txHash });
    return res.json(result);
  } catch (error: any) {
    console.error('Transaction error:', error);
    return res.status(500).json({ success: false, error: error.message });
  }
});

// send-batch-lana-transaction (multiple recipients in one TX)
router.post('/send-batch-lana-transaction', async (req: Request, res: Response) => {
  try {
    const result = await sendBatchLanaTransaction(req.body);
    return res.json(result);
  } catch (error: any) {
    console.error('Batch transaction error:', error);
    return res.status(500).json({ success: false, error: error.message });
  }
});

// send-unconditional-payment (multi-recipient format)
router.post('/send-unconditional-payment', async (req: Request, res: Response) => {
  try {
    const { sender_address, recipients, private_key, electrum_servers } = req.body;

    if (!sender_address || !recipients || !private_key || recipients.length === 0) {
      return res.status(400).json({ success: false, error: 'Missing required parameters' });
    }

    // Convert amounts from LANA to satoshis (same as Supabase edge function)
    const recipientsInSatoshis = recipients.map((r: any) => {
      if (!r.address || typeof r.amount !== 'number') {
        throw new Error('Invalid recipient format: must have address and amount');
      }
      return { address: r.address, amount: Math.round(r.amount * 100000000) };
    });

    console.log(`📦 Unconditional payment: ${recipientsInSatoshis.length} outputs from ${sender_address}`);
    recipientsInSatoshis.forEach((r: any, i: number) => {
      console.log(`  ${i + 1}. ${r.address}: ${(r.amount / 100000000).toFixed(8)} LANA`);
    });

    const result = await sendBatchLanaTransaction({
      senderAddress: sender_address,
      recipients: recipientsInSatoshis,
      privateKey: private_key,
      electrumServers: electrum_servers
    });

    // Map txHash to txid for frontend compatibility
    return res.json({
      success: result.success,
      txid: result.txHash,
      totalAmount: result.totalAmount,
      fee: result.fee,
      error: result.error
    });
  } catch (error: any) {
    console.error('Unconditional payment error:', error);
    return res.status(500).json({ success: false, error: error.message });
  }
});

// send-lash-batch
router.post('/send-lash-batch', async (req: Request, res: Response) => {
  try {
    // sendLanaTransaction imported at top of file
    const { transactions } = req.body;
    const results: any[] = [];

    for (const tx of (transactions || [])) {
      try {
        const result = await sendLanaTransaction(tx);
        results.push({ ...result, index: tx.index });
      } catch (err: any) {
        results.push({ success: false, error: err.message, index: tx.index });
      }
    }

    return res.json({ results });
  } catch (error: any) {
    return res.status(500).json({ error: error.message });
  }
});

// =============================================
// REGISTER VIRGIN WALLET (proxy to lanawatch.us)
// =============================================
router.post('/register-virgin-wallet', async (req: Request, res: Response) => {
  try {
    const { nostr_id_hex, wallets } = req.body;
    if (!nostr_id_hex || !wallets?.length) {
      return res.status(400).json({ success: false, error: 'nostr_id_hex and wallets required' });
    }

    const apiKey = process.env.LANAWATCH_API_KEY;
    if (!apiKey) {
      console.error('LANAWATCH_API_KEY not configured in environment');
      return res.status(500).json({ success: false, error: 'LANAWATCH_API_KEY not configured' });
    }

    console.log(`📝 Registering ${wallets.length} virgin wallet(s) for ${nostr_id_hex.slice(0, 8)}...`);

    const response = await fetch('https://laluxmwarlejdwyboudz.supabase.co/functions/v1/register-virgin-wallets', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        method: 'register_virgin_wallets_for_existing_user',
        api_key: apiKey,
        data: { nostr_id_hex, wallets }
      }),
    });

    const result = await response.json();

    if (result.success) {
      console.log(`✅ Wallet registration successful: ${result.message || 'OK'}`);
    } else {
      console.warn(`⚠️ Wallet registration failed: ${result.error || result.message || 'Unknown error'}`);
    }

    return res.status(response.status).json(result);
  } catch (error: any) {
    console.error('Register virgin wallet error:', error);
    return res.status(500).json({ success: false, error: error.message });
  }
});

export default router;
