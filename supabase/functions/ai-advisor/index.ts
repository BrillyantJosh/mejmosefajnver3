import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

// ==================== TRIAD AI SYSTEM ====================
// Three-agent dialectical system for honest, verified responses
// BUILDER → SKEPTIC → MEDIATOR
// =========================================================

// Interface for knowledge entries
interface KnowledgeEntry {
  title: string;
  summary: string;
  body: string | null;
  topic: string | null;
  keywords: string[] | null;
  lang: string;
}

// Triad response interfaces
interface BuilderResponse {
  answer: string;
  assumptions: string[];
  steps_taken: string[];
  unknowns: string[];
  risks: string[];
  questions: string[];
}

interface SkepticResponse {
  claims_to_verify: string[];
  failure_modes: string[];
  missing_info: string[];
  recommended_changes: string[];
}

interface MediatorResponse {
  final_answer: string;
  confidence: number;
  what_i_did: string[];
  what_i_did_not_do: string[];
  next_step: string;
}

// Fetch relevant knowledge from ai_knowledge table
async function fetchRelevantKnowledge(userQuery: string, language: string): Promise<string> {
  try {
    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
    );

    const normalizedQuery = userQuery.toLowerCase()
      .replace(/[^\w\sčšžćđáéíóúäöüàèìòùâêîôûąęółńśźżæøå]/gi, ' ')
      .split(/\s+/)
      .filter(term => term.length > 2);

    const langCode = (language?.split('-')[0] || 'sl').toLowerCase();

    const { data: knowledge, error } = await supabase
      .from('ai_knowledge')
      .select('title, summary, body, topic, keywords, lang')
      .eq('status', 'active')
      .in('lang', [langCode, 'en'])
      .order('updated_at', { ascending: false })
      .limit(50);

    if (error || !knowledge || knowledge.length === 0) {
      return '';
    }

    const scoredKnowledge = (knowledge as KnowledgeEntry[]).map(k => {
      const searchableText = [k.title || '', k.summary || '', k.topic || '', ...(k.keywords || [])].join(' ').toLowerCase();
      let score = 0;
      for (const term of normalizedQuery) {
        if (searchableText.includes(term)) {
          score += 1;
          if ((k.title || '').toLowerCase().includes(term)) score += 2;
          if ((k.topic || '').toLowerCase().includes(term)) score += 1;
          if (k.keywords?.some(kw => kw.toLowerCase() === term)) score += 3;
        }
      }
      if (k.lang === langCode) score += 1;
      return { ...k, score };
    });

    const relevantKnowledge = scoredKnowledge.filter(k => k.score > 0).sort((a, b) => b.score - a.score).slice(0, 5);

    if (relevantKnowledge.length === 0) {
      const generalKnowledge = (knowledge as KnowledgeEntry[]).filter(k => k.lang === langCode).slice(0, 3);
      if (generalKnowledge.length === 0) return '';
      return generalKnowledge.map(k => `### ${k.title}\n${k.summary}${k.body ? `\n\n${k.body}` : ''}`).join('\n\n---\n\n');
    }

    return relevantKnowledge.map(k => `### ${k.title}\n${k.summary}${k.body ? `\n\n${k.body}` : ''}`).join('\n\n---\n\n');
  } catch {
    return '';
  }
}

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

// Model pricing per 1 million tokens (USD)
const MODEL_PRICING: Record<string, { input: number; output: number }> = {
  "google/gemini-3-flash-preview": { input: 0.10, output: 0.40 },
  "google/gemini-2.5-flash": { input: 0.075, output: 0.30 },
  "google/gemini-2.5-flash-lite": { input: 0.02, output: 0.08 },
};

function calculateCostUsd(model: string, promptTokens: number, completionTokens: number): number {
  const pricing = MODEL_PRICING[model] || { input: 0.10, output: 0.40 };
  return (promptTokens / 1_000_000) * pricing.input + (completionTokens / 1_000_000) * pricing.output;
}

// ==================== TRIAD PROMPTS ====================

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

You MUST output ONLY valid JSON in the exact structure below.
No explanations outside JSON.

JSON STRUCTURE:
{
  "answer": "Your proposed solution or response to the user (can be multiple paragraphs, use \\n for newlines)",
  "assumptions": ["List of assumptions you are making"],
  "steps_taken": ["Only steps you truly performed (thinking, reasoning, analysis)"],
  "unknowns": ["What is unclear or not verified"],
  "risks": ["Potential failure points or risks"],
  "questions": ["Up to 3 critical questions, only if truly needed - empty array if none"]
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

You MUST output ONLY valid JSON in the exact structure below.
No explanations outside JSON.

JSON STRUCTURE:
{
  "final_answer": "The most honest and grounded response to the user (can be multiple paragraphs with markdown formatting, use \\n for newlines)",
  "confidence": 75,
  "what_i_did": ["What was actually done - be specific"],
  "what_i_did_not_do": ["What was NOT done or cannot be guaranteed"],
  "next_step": "Smallest realistic and safe next step the user can take"
}`;

// Language-specific instructions to append
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

function getLanguageInstruction(lang: string): string {
  const langCode = (lang?.split('-')[0] || 'en').toLowerCase();
  return LANGUAGE_INSTRUCTIONS[langCode] || LANGUAGE_INSTRUCTIONS.en;
}

// ==================== AI CALL HELPERS ====================

async function callAI(
  apiKey: string,
  model: string,
  systemPrompt: string,
  userMessages: Array<{ role: string; content: string }>,
  stream: boolean = false
): Promise<{ content: string; usage: { prompt_tokens: number; completion_tokens: number; total_tokens: number } }> {
  const response = await fetch("https://ai.gateway.lovable.dev/v1/chat/completions", {
    method: "POST",
    headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      model,
      messages: [{ role: "system", content: systemPrompt }, ...userMessages],
      stream,
      ...(stream ? { stream_options: { include_usage: true } } : {}),
    }),
  });

  if (!response.ok) {
    throw new Error(`AI call failed: ${response.status}`);
  }

  if (stream) {
    return { content: "", usage: { prompt_tokens: 0, completion_tokens: 0, total_tokens: 0 } };
  }

  const data = await response.json();
  return {
    content: data.choices?.[0]?.message?.content || "",
    usage: data.usage || { prompt_tokens: 0, completion_tokens: 0, total_tokens: 0 },
  };
}

function parseJSON<T>(text: string, fallback: T): T {
  try {
    // Extract JSON from possible markdown code blocks
    const jsonMatch = text.match(/```(?:json)?\s*([\s\S]*?)```/) || text.match(/(\{[\s\S]*\})/);
    if (jsonMatch) {
      return JSON.parse(jsonMatch[1].trim());
    }
    return JSON.parse(text);
  } catch {
    console.error("Failed to parse JSON:", text.substring(0, 200));
    return fallback;
  }
}

// ==================== TRIAD EXECUTION WITH STREAMING PROGRESS ====================

// Progress messages by language
const PROGRESS_MESSAGES: Record<string, { builder: string; skeptic: string; mediator: string }> = {
  sl: {
    builder: "🔨 Pripravljam odgovor...",
    skeptic: "🔍 Preverjam točnost...",
    mediator: "⚖️ Sintetiziram končni odgovor...",
  },
  en: {
    builder: "🔨 Preparing response...",
    skeptic: "🔍 Verifying accuracy...",
    mediator: "⚖️ Synthesizing final answer...",
  },
  de: {
    builder: "🔨 Antwort vorbereiten...",
    skeptic: "🔍 Genauigkeit überprüfen...",
    mediator: "⚖️ Endgültige Antwort synthetisieren...",
  },
  hr: {
    builder: "🔨 Pripremam odgovor...",
    skeptic: "🔍 Provjeravam točnost...",
    mediator: "⚖️ Sintetiziram konačni odgovor...",
  },
  hu: {
    builder: "🔨 Válasz előkészítése...",
    skeptic: "🔍 Pontosság ellenőrzése...",
    mediator: "⚖️ Végső válasz szintetizálása...",
  },
  it: {
    builder: "🔨 Preparazione risposta...",
    skeptic: "🔍 Verifica accuratezza...",
    mediator: "⚖️ Sintesi risposta finale...",
  },
  es: {
    builder: "🔨 Preparando respuesta...",
    skeptic: "🔍 Verificando precisión...",
    mediator: "⚖️ Sintetizando respuesta final...",
  },
  pt: {
    builder: "🔨 Preparando resposta...",
    skeptic: "🔍 Verificando precisão...",
    mediator: "⚖️ Sintetizando resposta final...",
  },
};

function getProgressMessages(lang: string) {
  const langCode = (lang?.split('-')[0] || 'en').toLowerCase();
  return PROGRESS_MESSAGES[langCode] || PROGRESS_MESSAGES.en;
}

interface ProgressCallback {
  (phase: 'builder' | 'skeptic' | 'mediator'): void;
}

async function executeTriadWithProgress(
  apiKey: string,
  userQuestion: string,
  contextMessage: string,
  language: string,
  onProgress: ProgressCallback
): Promise<{ mediator: MediatorResponse; builder: BuilderResponse; skeptic: SkepticResponse; totalUsage: { prompt_tokens: number; completion_tokens: number; total_tokens: number } }> {
  const langInstruction = getLanguageInstruction(language);
  const fastModel = "google/gemini-2.5-flash-lite";
  const smartModel = "google/gemini-3-flash-preview";

  let totalUsage = { prompt_tokens: 0, completion_tokens: 0, total_tokens: 0 };

  // Step 1: BUILDER
  onProgress('builder');
  console.log("🔨 BUILDER starting...");
  const builderPrompt = BUILDER_PROMPT + langInstruction + "\n\n" + contextMessage;
  const builderResult = await callAI(apiKey, fastModel, builderPrompt, [{ role: "user", content: userQuestion }]);
  totalUsage.prompt_tokens += builderResult.usage.prompt_tokens;
  totalUsage.completion_tokens += builderResult.usage.completion_tokens;
  totalUsage.total_tokens += builderResult.usage.total_tokens;

  const builderResponse = parseJSON<BuilderResponse>(builderResult.content, {
    answer: "Ni mi uspelo analizirati vprašanja.",
    assumptions: [],
    steps_taken: ["Attempted analysis"],
    unknowns: ["Analysis failed"],
    risks: [],
    questions: [],
  });
  console.log("🔨 BUILDER done:", builderResponse.answer.substring(0, 100));

  // Step 2: SKEPTIC
  onProgress('skeptic');
  console.log("🔍 SKEPTIC starting...");
  const skepticInput = `USER QUESTION:\n${userQuestion}\n\nBUILDER'S RESPONSE:\n${JSON.stringify(builderResponse, null, 2)}\n\nUSER DATA CONTEXT:\n${contextMessage}`;
  const skepticResult = await callAI(apiKey, fastModel, SKEPTIC_PROMPT, [{ role: "user", content: skepticInput }]);
  totalUsage.prompt_tokens += skepticResult.usage.prompt_tokens;
  totalUsage.completion_tokens += skepticResult.usage.completion_tokens;
  totalUsage.total_tokens += skepticResult.usage.total_tokens;

  const skepticResponse = parseJSON<SkepticResponse>(skepticResult.content, {
    claims_to_verify: [],
    failure_modes: [],
    missing_info: [],
    recommended_changes: [],
  });
  console.log("🔍 SKEPTIC done, found", skepticResponse.claims_to_verify.length, "claims to verify");

  // Step 3: MEDIATOR
  onProgress('mediator');
  console.log("⚖️ MEDIATOR starting...");
  const mediatorInput = `USER QUESTION:\n${userQuestion}\n\nBUILDER JSON:\n${JSON.stringify(builderResponse, null, 2)}\n\nSKEPTIC JSON:\n${JSON.stringify(skepticResponse, null, 2)}\n\nUSER DATA CONTEXT (for reference):\n${contextMessage}`;
  const mediatorPrompt = MEDIATOR_PROMPT + langInstruction;
  const mediatorResult = await callAI(apiKey, smartModel, mediatorPrompt, [{ role: "user", content: mediatorInput }]);
  totalUsage.prompt_tokens += mediatorResult.usage.prompt_tokens;
  totalUsage.completion_tokens += mediatorResult.usage.completion_tokens;
  totalUsage.total_tokens += mediatorResult.usage.total_tokens;

  const mediatorResponse = parseJSON<MediatorResponse>(mediatorResult.content, {
    final_answer: builderResponse.answer,
    confidence: 50,
    what_i_did: builderResponse.steps_taken,
    what_i_did_not_do: builderResponse.unknowns,
    next_step: "Poskusi znova ali postavi bolj specifično vprašanje.",
  });
  console.log("⚖️ MEDIATOR done, confidence:", mediatorResponse.confidence);

  return { mediator: mediatorResponse, builder: builderResponse, skeptic: skepticResponse, totalUsage };
}

// ==================== USAGE LOGGING ====================

async function logUsage(
  nostrHexId: string,
  model: string,
  usage: { prompt_tokens: number; completion_tokens: number; total_tokens: number },
  usdToLanaRate: number
) {
  try {
    const supabase = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
    const costUsd = calculateCostUsd(model, usage.prompt_tokens, usage.completion_tokens);
    const costLana = costUsd * usdToLanaRate;

    await supabase.from('ai_usage_logs').insert({
      nostr_hex_id: nostrHexId,
      model: "triad-system", // Mark as triad
      prompt_tokens: usage.prompt_tokens,
      completion_tokens: usage.completion_tokens,
      total_tokens: usage.total_tokens,
      cost_usd: costUsd,
      cost_lana: costLana,
    });
    console.log(`📊 Logged triad usage: ${usage.total_tokens} tokens, $${costUsd.toFixed(6)} USD`);
  } catch (err) {
    console.error("Failed to log usage:", err);
  }
}

// ==================== MAIN HANDLER ====================

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const { messages, context, language, nostrHexId, usdToLanaRate } = await req.json();
    const LOVABLE_API_KEY = Deno.env.get("LOVABLE_API_KEY");
    if (!LOVABLE_API_KEY) throw new Error("AI service is not configured");

    console.log(`🎯 TRIAD AI request from ${nostrHexId?.substring(0, 16)}...`);
    console.log(`👤 userProfile: name=${context?.userProfile?.name ?? 'N/A'}, displayName=${context?.userProfile?.displayName ?? 'N/A'}`);

    // Get last user message
    const lastUserMessage = messages.filter((m: any) => m.role === 'user').pop()?.content || '';

    // Fetch relevant knowledge
    const knowledgeContext = await fetchRelevantKnowledge(lastUserMessage, language || 'sl');

    // Build context message
    let contextMessage = "";
    if (context) {
      contextMessage = `USER DATA:\n${JSON.stringify(context, null, 2)}`;
    }
    if (knowledgeContext) {
      contextMessage += `\n\n=== LANA KNOWLEDGE BASE ===\n${knowledgeContext}\n=== END KNOWLEDGE BASE ===`;
    }

    // Get progress messages in user's language
    const progressMessages = getProgressMessages(language || 'sl');
    const encoder = new TextEncoder();

    // Create a streaming response with progress updates
    const stream = new ReadableStream({
      async start(controller) {
        try {
          let totalUsage = { prompt_tokens: 0, completion_tokens: 0, total_tokens: 0 };
          let builderResponse: BuilderResponse | null = null;
          let skepticResponse: SkepticResponse | null = null;
          let mediatorResponse: MediatorResponse | null = null;

          // Helper to send progress update
          const sendProgress = (message: string) => {
            const chunk = `data: ${JSON.stringify({ choices: [{ delta: { content: "" } }], progress: message })}\n\n`;
            controller.enqueue(encoder.encode(chunk));
          };

          // Step 1: BUILDER
          sendProgress(progressMessages.builder);
          console.log("🔨 BUILDER starting...");
          const langInstruction = getLanguageInstruction(language || 'sl');
          const fastModel = "google/gemini-2.5-flash-lite";
          const smartModel = "google/gemini-3-flash-preview";
          
          const builderPrompt = BUILDER_PROMPT + langInstruction + "\n\n" + contextMessage;
          const builderResult = await callAI(LOVABLE_API_KEY, fastModel, builderPrompt, [{ role: "user", content: lastUserMessage }]);
          totalUsage.prompt_tokens += builderResult.usage.prompt_tokens;
          totalUsage.completion_tokens += builderResult.usage.completion_tokens;
          totalUsage.total_tokens += builderResult.usage.total_tokens;

          builderResponse = parseJSON<BuilderResponse>(builderResult.content, {
            answer: "Ni mi uspelo analizirati vprašanja.",
            assumptions: [],
            steps_taken: ["Attempted analysis"],
            unknowns: ["Analysis failed"],
            risks: [],
            questions: [],
          });
          console.log("🔨 BUILDER done");

          // Step 2: SKEPTIC
          sendProgress(progressMessages.skeptic);
          console.log("🔍 SKEPTIC starting...");
          const skepticInput = `USER QUESTION:\n${lastUserMessage}\n\nBUILDER'S RESPONSE:\n${JSON.stringify(builderResponse, null, 2)}\n\nUSER DATA CONTEXT:\n${contextMessage}`;
          const skepticResult = await callAI(LOVABLE_API_KEY, fastModel, SKEPTIC_PROMPT, [{ role: "user", content: skepticInput }]);
          totalUsage.prompt_tokens += skepticResult.usage.prompt_tokens;
          totalUsage.completion_tokens += skepticResult.usage.completion_tokens;
          totalUsage.total_tokens += skepticResult.usage.total_tokens;

          skepticResponse = parseJSON<SkepticResponse>(skepticResult.content, {
            claims_to_verify: [],
            failure_modes: [],
            missing_info: [],
            recommended_changes: [],
          });
          console.log("🔍 SKEPTIC done");

          // Step 3: MEDIATOR
          sendProgress(progressMessages.mediator);
          console.log("⚖️ MEDIATOR starting...");
          const mediatorInput = `USER QUESTION:\n${lastUserMessage}\n\nBUILDER JSON:\n${JSON.stringify(builderResponse, null, 2)}\n\nSKEPTIC JSON:\n${JSON.stringify(skepticResponse, null, 2)}\n\nUSER DATA CONTEXT (for reference):\n${contextMessage}`;
          const mediatorPrompt = MEDIATOR_PROMPT + langInstruction;
          const mediatorResult = await callAI(LOVABLE_API_KEY, smartModel, mediatorPrompt, [{ role: "user", content: mediatorInput }]);
          totalUsage.prompt_tokens += mediatorResult.usage.prompt_tokens;
          totalUsage.completion_tokens += mediatorResult.usage.completion_tokens;
          totalUsage.total_tokens += mediatorResult.usage.total_tokens;

          mediatorResponse = parseJSON<MediatorResponse>(mediatorResult.content, {
            final_answer: builderResponse.answer,
            confidence: 50,
            what_i_did: builderResponse.steps_taken,
            what_i_did_not_do: builderResponse.unknowns,
            next_step: "Poskusi znova ali postavi bolj specifično vprašanje.",
          });
          console.log("⚖️ MEDIATOR done, confidence:", mediatorResponse.confidence);

          // Log usage
          if (nostrHexId) {
            await logUsage(nostrHexId, "triad-system", totalUsage, usdToLanaRate || 270);
          }

          // Build the final response with triad metadata
          const triadResult = {
            type: "triad",
            final_answer: mediatorResponse.final_answer,
            confidence: mediatorResponse.confidence,
            what_i_did: mediatorResponse.what_i_did,
            what_i_did_not_do: mediatorResponse.what_i_did_not_do,
            next_step: mediatorResponse.next_step,
            _debug: {
              builder: {
                answer_preview: builderResponse.answer.substring(0, 200),
                assumptions: builderResponse.assumptions,
                risks: builderResponse.risks,
                questions: builderResponse.questions,
              },
              skeptic: {
                claims_to_verify: skepticResponse.claims_to_verify,
                failure_modes: skepticResponse.failure_modes,
                missing_info: skepticResponse.missing_info,
              },
            },
          };

          // Send final result
          const finalChunk = `data: ${JSON.stringify({ choices: [{ delta: { content: JSON.stringify(triadResult) } }] })}\n\n`;
          controller.enqueue(encoder.encode(finalChunk));
          controller.enqueue(encoder.encode("data: [DONE]\n\n"));
          controller.close();
        } catch (err) {
          console.error("Triad stream error:", err);
          controller.error(err);
        }
      },
    });

    return new Response(stream, { headers: { ...corsHeaders, "Content-Type": "text/event-stream" } });
  } catch (error) {
    console.error("Triad error:", error);
    return new Response(JSON.stringify({ error: error instanceof Error ? error.message : "Unknown error" }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
