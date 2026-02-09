import Database from 'better-sqlite3';
import { fetchUserWallets, queryEventsFromRelays } from './nostr';
import { fetchBatchBalances, ElectrumServer } from './electrum';
import { sendPushToUser } from './pushNotification';

// =============================================
// Types
// =============================================

interface PendingTask {
  id: string;
  nostr_hex_id: string;
  question: string;
  language: string;
  missing_fields: string;
  partial_context: string;
  partial_answer: string | null;
  status: string;
  retry_count: number;
  max_retries: number;
  created_at: string;
  usd_to_lana_rate: number;
}

// =============================================
// Detect missing fields in context
// =============================================

const TRACKABLE_FIELDS = ['wallets', 'unconditionalPayments'] as const;

export function detectMissingFields(context: any): string[] {
  if (!context) return [...TRACKABLE_FIELDS];
  const missing: string[] = [];
  for (const field of TRACKABLE_FIELDS) {
    if (context[field] === null || context[field] === undefined) {
      missing.push(field);
    }
  }
  return missing;
}

// =============================================
// Create a pending task
// =============================================

export function createPendingTask(db: Database.Database, params: {
  nostrHexId: string;
  question: string;
  language: string;
  missingFields: string[];
  partialContext: any;
  partialAnswer: string;
  usdToLanaRate: number;
}): string {
  // Cancel any existing pending tasks for this user
  db.prepare(`
    UPDATE ai_pending_tasks SET status = 'cancelled', updated_at = datetime('now')
    WHERE nostr_hex_id = ? AND status = 'pending'
  `).run(params.nostrHexId);

  const result = db.prepare(`
    INSERT INTO ai_pending_tasks (id, nostr_hex_id, question, language, missing_fields, partial_context, partial_answer, usd_to_lana_rate)
    VALUES (lower(hex(randomblob(16))), ?, ?, ?, ?, ?, ?, ?)
  `).run(
    params.nostrHexId,
    params.question,
    params.language,
    JSON.stringify(params.missingFields),
    JSON.stringify(params.partialContext),
    params.partialAnswer,
    params.usdToLanaRate
  );

  // Get the inserted ID
  const inserted = db.prepare(`
    SELECT id FROM ai_pending_tasks WHERE nostr_hex_id = ? AND status = 'pending' ORDER BY created_at DESC LIMIT 1
  `).get(params.nostrHexId) as any;

  const taskId = inserted?.id || 'unknown';
  console.log(`📋 Created pending AI task ${taskId} for ${params.nostrHexId.substring(0, 16)}... (missing: ${params.missingFields.join(', ')})`);
  return taskId;
}

// =============================================
// Fetch missing data server-side
// =============================================

function getRelaysFromDb(db: Database.Database): string[] {
  const row = db.prepare('SELECT relays FROM kind_38888 ORDER BY created_at DESC LIMIT 1').get() as any;
  if (row) {
    try {
      const parsed = JSON.parse(row.relays);
      if (Array.isArray(parsed) && parsed.length > 0) return parsed;
    } catch {}
  }
  return [];
}

function getTrustedSignersFromDb(db: Database.Database): string[] {
  const row = db.prepare('SELECT trusted_signers FROM kind_38888 ORDER BY created_at DESC LIMIT 1').get() as any;
  if (row?.trusted_signers) {
    try {
      const parsed = JSON.parse(row.trusted_signers);
      if (parsed?.LanaRegistrar && Array.isArray(parsed.LanaRegistrar)) {
        return parsed.LanaRegistrar;
      }
    } catch {}
  }
  return [];
}

function getElectrumServersFromDb(db: Database.Database): ElectrumServer[] {
  const row = db.prepare('SELECT electrum_servers FROM kind_38888 ORDER BY created_at DESC LIMIT 1').get() as any;
  if (row?.electrum_servers) {
    try {
      const parsed = JSON.parse(row.electrum_servers);
      return parsed.map((s: any) => ({
        host: s.host,
        port: typeof s.port === 'string' ? parseInt(s.port, 10) : s.port,
      }));
    } catch {}
  }
  return [
    { host: 'electrum1.lanacoin.com', port: 5097 },
    { host: 'electrum2.lanacoin.com', port: 5097 },
    { host: 'electrum3.lanacoin.com', port: 5097 },
  ];
}

export async function fetchMissingData(
  db: Database.Database,
  missingFields: string[],
  nostrHexId: string
): Promise<Record<string, any>> {
  const result: Record<string, any> = {};
  const relays = getRelaysFromDb(db);

  if (relays.length === 0) {
    console.warn('⚠️ No relays available for fetching missing data');
    return result;
  }

  for (const field of missingFields) {
    try {
      switch (field) {
        case 'wallets': {
          const trustedSigners = getTrustedSignersFromDb(db);
          const wallets = await fetchUserWallets(nostrHexId, relays, trustedSigners);
          if (wallets && wallets.length > 0) {
            // Also fetch balances
            const addresses = wallets.map((w: any) => w.address).filter(Boolean);
            if (addresses.length > 0) {
              const servers = getElectrumServersFromDb(db);
              const balances = await fetchBatchBalances(servers, addresses);
              // Merge balances into wallets
              const balanceMap = new Map(balances.map(b => [b.address, b]));
              result.wallets = wallets.map((w: any) => {
                const bal = balanceMap.get(w.address);
                return {
                  ...w,
                  balance: bal ? bal.balance : 0,
                  balanceError: bal?.error || null,
                };
              });
            } else {
              result.wallets = wallets;
            }
          }
          break;
        }

        case 'unconditionalPayments': {
          // Fetch KIND 90900 (proposals) and 90901 (acceptances) for user
          const [proposals, acceptances] = await Promise.all([
            queryEventsFromRelays(relays, { kinds: [90900], '#p': [nostrHexId], limit: 100 }, 15000),
            queryEventsFromRelays(relays, { kinds: [90901], limit: 200 }, 15000),
          ]);
          if (proposals.length > 0 || acceptances.length > 0) {
            result.unconditionalPayments = { proposals, acceptances };
          }
          break;
        }

        case 'events': {
          const events = await queryEventsFromRelays(relays, { kinds: [36677], limit: 100 }, 15000);
          if (events.length > 0) {
            // Basic parsing — filter active events
            const now = Math.floor(Date.now() / 1000);
            const activeEvents = events.filter((e: any) => {
              const endTag = e.tags?.find((t: any) => t[0] === 'end');
              const endTime = endTag ? parseInt(endTag[1]) : 0;
              return endTime === 0 || endTime > now;
            });
            result.events = activeEvents.map((e: any) => {
              const dTag = e.tags?.find((t: any) => t[0] === 'd');
              const titleTag = e.tags?.find((t: any) => t[0] === 'title' || t[0] === 'name');
              const startTag = e.tags?.find((t: any) => t[0] === 'start');
              const locationTag = e.tags?.find((t: any) => t[0] === 'location');
              return {
                id: dTag?.[1] || e.id,
                title: titleTag?.[1] || 'Unnamed event',
                start: startTag?.[1] || null,
                location: locationTag?.[1] || null,
              };
            });
          }
          break;
        }
      }
    } catch (err: any) {
      console.error(`⚠️ Failed to fetch ${field} for task:`, err.message);
    }
  }

  return result;
}

// =============================================
// Check if we got new meaningful data
// =============================================

export function hasNewData(partialContext: any, newData: Record<string, any>, missingFields: string[]): boolean {
  for (const field of missingFields) {
    const newValue = newData[field];
    if (newValue !== null && newValue !== undefined) {
      if (Array.isArray(newValue) && newValue.length > 0) return true;
      if (typeof newValue === 'object' && !Array.isArray(newValue) && Object.keys(newValue).length > 0) return true;
    }
  }
  return false;
}

// =============================================
// Run Triad AI (reusable from route)
// =============================================

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

function parseTriadJSON<T>(text: string, fallback: T): T {
  try {
    let cleaned = text.trim();
    const jsonMatch = cleaned.match(/```(?:json)?\s*([\s\S]*?)```/);
    if (jsonMatch) cleaned = jsonMatch[1].trim();
    return JSON.parse(cleaned);
  } catch {
    return fallback;
  }
}

// Prompts (same as in functions.ts)
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
  "claims_to_verify": ["Claims from BUILDER that need proof or evidence"],
  "failure_modes": ["How the proposed solution could fail"],
  "missing_info": ["What information is missing"],
  "recommended_changes": ["What should BUILDER change"]
}`;

const MEDIATOR_PROMPT = `You are MEDIATOR.

Your job is to synthesize BUILDER and SKEPTIC into an honest, actionable final answer for the user.

RULES:
- Combine the best of both.
- Be honest about confidence level.
- Output confidence as a number 0-100 based on data quality and uncertainty.
- what_i_did = things you/AI actually analyzed or calculated.
- what_i_did_not_do = things you could NOT do (no API calls, no real-time data, etc.)
- next_step = one clear next action for the user.
- NEVER mention loading, connection issues, or data availability. Answer with what you have.
- CRITICAL: If BUILDER's response includes a "payment_intent" object, you MUST include it as a separate "payment_intent" field in YOUR response too. Copy it exactly as-is. Without it the payment form will NOT open. Do NOT put payment JSON inside the "final_answer" text.

You MUST output ONLY valid JSON in the exact structure below.
No explanations outside JSON.

JSON STRUCTURE:
{
  "final_answer": "The synthesized final response to the user (multiple paragraphs ok, use \\n for newlines). Do NOT embed any JSON objects here.",
  "payment_intent": null,
  "confidence": 75,
  "what_i_did": ["List of actual steps performed by AI"],
  "what_i_did_not_do": ["What AI could not verify or do"],
  "next_step": "One clear suggested next action for the user"
}`;

const LANGUAGE_INSTRUCTIONS: Record<string, string> = {
  sl: '\n\nIMPORTANT: You MUST respond ENTIRELY in Slovenian (slovenščina).',
  en: '\n\nIMPORTANT: Respond in English.',
  de: '\n\nIMPORTANT: Respond in German (Deutsch).',
  hr: '\n\nIMPORTANT: Respond in Croatian (Hrvatski).',
  hu: '\n\nIMPORTANT: Respond in Hungarian (Magyar).',
  it: '\n\nIMPORTANT: Respond in Italian (Italiano).',
  es: '\n\nIMPORTANT: Respond in Spanish (Español).',
  pt: '\n\nIMPORTANT: Respond in Portuguese (Português).',
};

export async function runTriadAI(params: {
  db: Database.Database;
  question: string;
  context: any;
  language: string;
  nostrHexId: string;
  usdToLanaRate: number;
}): Promise<{ triadResult: any; totalUsage: any } | null> {
  const GEMINI_API_KEY = process.env.GEMINI_API_KEY;
  if (!GEMINI_API_KEY) {
    console.error('GEMINI_API_KEY not configured for async task');
    return null;
  }

  const { db, question, context, language, nostrHexId, usdToLanaRate } = params;
  const langCode = (language?.split('-')[0] || 'sl').toLowerCase();

  // Fetch knowledge base
  const knowledge = db.prepare(`
    SELECT title, summary, body, topic, keywords, lang FROM ai_knowledge
    WHERE status = 'active' AND (lang = ? OR lang = 'en')
    ORDER BY created_at DESC LIMIT 50
  `).all(langCode) as any[];

  // Score knowledge by relevance
  const queryTerms = question.toLowerCase().replace(/[^\w\sčšžćđ]/gi, ' ').split(/\s+/).filter((t: string) => t.length > 2);
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

  let contextMessage = '';
  if (context) contextMessage = `USER DATA:\n${JSON.stringify(context, null, 2)}`;
  if (knowledgeText) contextMessage += `\n\n=== LANA KNOWLEDGE BASE ===\n${knowledgeText}\n=== END KNOWLEDGE BASE ===`;

  const langInstruction = LANGUAGE_INSTRUCTIONS[langCode] || LANGUAGE_INSTRUCTIONS.en;
  const fastModel = 'gemini-2.0-flash-lite';
  const smartModel = 'gemini-2.0-flash';

  let totalUsage = { prompt_tokens: 0, completion_tokens: 0, total_tokens: 0 };

  // BUILDER
  console.log('🔨 [TASK] BUILDER starting...');
  const builderResult = await callGemini(GEMINI_API_KEY, fastModel, BUILDER_PROMPT + langInstruction + '\n\n' + contextMessage, question);
  totalUsage.prompt_tokens += builderResult.usage.prompt_tokens;
  totalUsage.completion_tokens += builderResult.usage.completion_tokens;
  totalUsage.total_tokens += builderResult.usage.total_tokens;

  const builderResponse = parseTriadJSON(builderResult.content, {
    answer: 'Ni mi uspelo analizirati vprašanja.',
    assumptions: [], steps_taken: ['Attempted analysis'], unknowns: ['Analysis failed'], risks: [], questions: [],
  });

  // SKEPTIC
  console.log('🔍 [TASK] SKEPTIC starting...');
  const skepticInput = `USER QUESTION:\n${question}\n\nBUILDER'S RESPONSE:\n${JSON.stringify(builderResponse, null, 2)}\n\nUSER DATA CONTEXT:\n${contextMessage}`;
  const skepticResult = await callGemini(GEMINI_API_KEY, fastModel, SKEPTIC_PROMPT, skepticInput);
  totalUsage.prompt_tokens += skepticResult.usage.prompt_tokens;
  totalUsage.completion_tokens += skepticResult.usage.completion_tokens;
  totalUsage.total_tokens += skepticResult.usage.total_tokens;

  const skepticResponse = parseTriadJSON(skepticResult.content, {
    claims_to_verify: [], failure_modes: [], missing_info: [], recommended_changes: [],
  });

  // MEDIATOR
  console.log('⚖️ [TASK] MEDIATOR starting...');
  const mediatorInput = `USER QUESTION:\n${question}\n\nBUILDER JSON:\n${JSON.stringify(builderResponse, null, 2)}\n\nSKEPTIC JSON:\n${JSON.stringify(skepticResponse, null, 2)}\n\nUSER DATA CONTEXT (for reference):\n${contextMessage}`;
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

  // Log usage
  if (nostrHexId) {
    try {
      const costUsd = (totalUsage.prompt_tokens / 1_000_000) * 0.02 + (totalUsage.completion_tokens / 1_000_000) * 0.08;
      const costLana = costUsd * (usdToLanaRate || 270);
      db.prepare(`
        INSERT INTO ai_usage_logs (id, nostr_hex_id, model, prompt_tokens, completion_tokens, total_tokens, cost_usd, cost_lana)
        VALUES (lower(hex(randomblob(16))), ?, 'triad-gemini-async', ?, ?, ?, ?, ?)
      `).run(nostrHexId, totalUsage.prompt_tokens, totalUsage.completion_tokens, totalUsage.total_tokens, costUsd, costLana);
    } catch (err) {
      console.error('Failed to log async AI usage:', err);
    }
  }

  const triadResult = {
    type: 'triad',
    final_answer: mediatorResponse.final_answer,
    confidence: mediatorResponse.confidence,
    what_i_did: mediatorResponse.what_i_did,
    what_i_did_not_do: mediatorResponse.what_i_did_not_do,
    next_step: mediatorResponse.next_step,
    _debug: {
      builder: { answer_preview: builderResponse.answer.substring(0, 200), assumptions: builderResponse.assumptions, risks: builderResponse.risks, questions: builderResponse.questions },
      skeptic: { claims_to_verify: skepticResponse.claims_to_verify, failure_modes: skepticResponse.failure_modes, missing_info: skepticResponse.missing_info },
    },
  };

  return { triadResult, totalUsage };
}

// =============================================
// Process pending tasks (called by heartbeat)
// =============================================

// Import will be set by the caller (server/index.ts) to avoid circular deps
let _emitAiTaskUpdate: ((nostrHexId: string, data: any) => void) | null = null;
let _isUserConnected: ((nostrHexId: string) => boolean) | null = null;

export function setSSEHandlers(
  emitFn: (nostrHexId: string, data: any) => void,
  isConnectedFn: (nostrHexId: string) => boolean
) {
  _emitAiTaskUpdate = emitFn;
  _isUserConnected = isConnectedFn;
}

export async function processPendingTasks(db: Database.Database): Promise<void> {
  // Expire old tasks (older than 30 minutes)
  db.prepare(`
    UPDATE ai_pending_tasks SET status = 'expired', updated_at = datetime('now')
    WHERE status = 'pending' AND created_at < datetime('now', '-30 minutes')
  `).run();

  // Unstick tasks stuck in "processing" for more than 5 minutes (crashed/hung)
  db.prepare(`
    UPDATE ai_pending_tasks SET status = 'pending', updated_at = datetime('now')
    WHERE status = 'processing' AND updated_at < datetime('now', '-5 minutes')
  `).run();

  // Get pending tasks
  const tasks = db.prepare(`
    SELECT * FROM ai_pending_tasks WHERE status = 'pending' ORDER BY created_at ASC LIMIT 5
  `).all() as PendingTask[];

  if (tasks.length === 0) return;

  console.log(`📋 Processing ${tasks.length} pending AI task(s)...`);

  for (const task of tasks) {
    try {
      // Mark as processing
      db.prepare(`UPDATE ai_pending_tasks SET status = 'processing', updated_at = datetime('now') WHERE id = ?`).run(task.id);

      const missingFields = JSON.parse(task.missing_fields) as string[];
      const partialContext = JSON.parse(task.partial_context);

      // Fetch missing data server-side
      console.log(`🔄 Task ${task.id}: fetching ${missingFields.join(', ')} for ${task.nostr_hex_id.substring(0, 16)}...`);
      const newData = await fetchMissingData(db, missingFields, task.nostr_hex_id);

      // Check if we got new meaningful data
      if (!hasNewData(partialContext, newData, missingFields)) {
        // No new data — increment retry or expire
        const newRetryCount = task.retry_count + 1;
        if (newRetryCount >= task.max_retries) {
          db.prepare(`UPDATE ai_pending_tasks SET status = 'expired', retry_count = ?, updated_at = datetime('now') WHERE id = ?`).run(newRetryCount, task.id);
          console.log(`⏰ Task ${task.id} expired after ${newRetryCount} retries (no new data)`);
        } else {
          db.prepare(`UPDATE ai_pending_tasks SET status = 'pending', retry_count = ?, updated_at = datetime('now') WHERE id = ?`).run(newRetryCount, task.id);
          console.log(`🔁 Task ${task.id} retry ${newRetryCount}/${task.max_retries} (no new data yet)`);
        }
        continue;
      }

      // Merge partial context with new data
      const fullContext = { ...partialContext, ...newData };
      console.log(`✅ Task ${task.id}: got new data for ${Object.keys(newData).join(', ')}. Running Triad AI...`);

      // Run Triad AI with full context
      const result = await runTriadAI({
        db,
        question: task.question,
        context: fullContext,
        language: task.language,
        nostrHexId: task.nostr_hex_id,
        usdToLanaRate: task.usd_to_lana_rate,
      });

      if (!result) {
        db.prepare(`UPDATE ai_pending_tasks SET status = 'expired', updated_at = datetime('now') WHERE id = ?`).run(task.id);
        continue;
      }

      // Mark as completed
      db.prepare(`
        UPDATE ai_pending_tasks SET status = 'completed', full_answer = ?, completed_at = datetime('now'), updated_at = datetime('now') WHERE id = ?
      `).run(JSON.stringify(result.triadResult), task.id);

      console.log(`✅ Task ${task.id} completed! Confidence: ${result.triadResult.confidence}%`);

      // Deliver result
      const isConnected = _isUserConnected?.(task.nostr_hex_id) || false;

      if (isConnected && _emitAiTaskUpdate) {
        // User is on the page — send via SSE
        _emitAiTaskUpdate(task.nostr_hex_id, {
          taskId: task.id,
          type: 'updated_answer',
          answer: result.triadResult,
          originalQuestion: task.question,
        });
        console.log(`📡 Sent updated answer via SSE to ${task.nostr_hex_id.substring(0, 16)}...`);
      } else {
        // User left the page — send push notification
        const langCode = task.language?.split('-')[0] || 'sl';
        const title = langCode === 'sl' ? '🧠 Enlightened AI — posodobljen odgovor' : '🧠 Enlightened AI — updated answer';
        const body = result.triadResult.final_answer.substring(0, 120) + '...';

        await sendPushToUser(db, task.nostr_hex_id, {
          title,
          body,
          url: '/ai-advisor',
          tag: `ai-task-${task.id}`,
        });
        console.log(`🔔 Sent push notification to ${task.nostr_hex_id.substring(0, 16)}...`);
      }

    } catch (err: any) {
      console.error(`❌ Error processing task ${task.id}:`, err.message);
      // Set back to pending for retry
      db.prepare(`
        UPDATE ai_pending_tasks SET status = 'pending', retry_count = retry_count + 1, updated_at = datetime('now') WHERE id = ?
      `).run(task.id);
    }
  }
}
