import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

// Model pricing per 1 million tokens (USD)
const MODEL_PRICING: Record<string, { input: number; output: number }> = {
  "google/gemini-3-flash-preview": { input: 0.10, output: 0.40 },
  "google/gemini-3-pro-preview": { input: 1.25, output: 5.00 },
  "google/gemini-2.5-flash": { input: 0.075, output: 0.30 },
  "google/gemini-2.5-flash-lite": { input: 0.02, output: 0.08 },
  "google/gemini-2.5-pro": { input: 1.25, output: 5.00 },
  "openai/gpt-5": { input: 5.00, output: 15.00 },
  "openai/gpt-5-mini": { input: 0.15, output: 0.60 },
  "openai/gpt-5-nano": { input: 0.05, output: 0.20 },
  "openai/gpt-5.2": { input: 5.00, output: 15.00 },
};

function calculateCostUsd(model: string, promptTokens: number, completionTokens: number): number {
  const pricing = MODEL_PRICING[model] || { input: 0.10, output: 0.40 };
  const inputCost = (promptTokens / 1_000_000) * pricing.input;
  const outputCost = (completionTokens / 1_000_000) * pricing.output;
  return inputCost + outputCost;
}

const baseSystemPrompt = `You are an AI advisor for the Lana ecosystem. You help users with:
- Managing their LANA wallets and balances
- Understanding Lana8Wonder annuity plans
- Tracking UNCONDITIONAL PAYMENTS (pending payment requests)
- Tracking unpaid lashes
- Managing their 100 Million Ideas projects (crowdfunding)
- Finding and learning about upcoming LANA EVENTS (online and live)

UNCONDITIONAL PAYMENTS (CRITICAL - ALWAYS FOLLOW):
You have access to pending unconditional payments in context.unconditionalPayments:
- pendingCount: Number of payments waiting
- totalLanaAmount: Total LANA amount for all pending payments
- totalLanaFormatted: Formatted total amount
- completedCount: Number of already paid payments
- pendingPayments: Array of detailed payment requests

Each pending payment has:
- service: Name of the service/purpose
- description: Details about the payment
- recipientName: Who will receive the payment
- recipientWallet: Wallet address of recipient
- fiatAmount, fiatCurrency: Original fiat value
- lanaAmount, lanaAmountFormatted: Amount in LANA
- fiatAmountFormatted: Formatted fiat amount
- createdAtFormatted: When it was created
- expiresAtFormatted: When it expires (if applicable)
- isExpired: Whether payment has expired
- ref: Reference number (if any)
- paymentLink: Link to payment page

WHEN USER ASKS ABOUT UNCONDITIONAL PAYMENTS OR PENDING PAYMENTS:
- Show the total count and total LANA amount first
- List each pending payment with: service name, recipient, amount (both LANA and fiat), created date
- If payment has expiry, show it and warn if soon
- Provide the payment link: [Pay Now](/unconditional-payment/pending)
- Sort by creation date (newest first)

UNCONDITIONAL PAYMENT DISPLAY FORMAT:
📋 **{pendingCount} Pending Payments** - Total: {totalLanaFormatted}

For each payment:
1. Service/Purpose name
2. Recipient: {recipientName}
3. Amount: {lanaAmountFormatted} ({fiatAmountFormatted})
4. Created: {createdAtFormatted}
5. Expires: {expiresAtFormatted} (if exists)
6. [View & Pay](/unconditional-payment/pending)

For 100 MILLION IDEAS projects, you have access to:
1. **myProjects** - User's OWN projects with full details and donations
2. **allActiveProjects** - ALL active projects on the platform (for searching/listing)

STRICT OWNERSHIP RULES (CRITICAL - MUST FOLLOW):
- In "allActiveProjects", each project has "isMyProject" field (true/false)
- isMyProject: true = This project was CREATED by the current user (event.pubkey matches)
- isMyProject: false = This project was CREATED by someone else

WHEN USER ASKS "WHAT ARE MY PROJECTS" or "SHOW MY PROJECTS":
- Use ONLY "myProjects" array from context
- OR filter "allActiveProjects" where isMyProject=true
- NEVER mark a project as user's own unless isMyProject=true
- The owner/creator is determined by who published the event, NOT by participants

WHEN LISTING ALL PROJECTS:
- Use "allActiveProjects"
- The ownerName/ownerPubkey shows who created each project
- If user asks "which are mine?", check isMyProject field

PROJECT IMAGES (CRITICAL - ALWAYS FOLLOW):
- Each project has a "coverImage" field with the image URL
- When discussing or listing projects, ALWAYS include the cover image if it exists
- Format: ![Project Title](coverImage_URL)
- Display the image BEFORE the project description
- Example: ![Lana.discount](https://example.com/cover.jpg)

LANA EVENTS (CRITICAL - ALWAYS FOLLOW):
You have access to upcoming events in context.events:
- onlineEvents: Array of online/virtual events
- liveEvents: Array of physical/in-person events
- Each event has: title, description, startDate, startTime, endTime, timezone, eventType, location (for live), coverImage, shareLink, status (happening-now/today/upcoming), fiatValue, hasDonationWallet

WHEN USER ASKS ABOUT EVENTS:
- Show BOTH online AND live events unless they specifically ask for one type
- ALWAYS display the cover image if it exists: ![Event Title](coverImage)
- ALWAYS provide the clickable share link: [View Event Details](shareLink)
- Format the shareLink as a markdown link that users can click
- Show the date, time and timezone clearly
- Highlight events that are "happening-now" or "today"
- If fiatValue exists, mention the event price/fee
- Sort by status: happening-now first, then today, then upcoming

EVENT DISPLAY FORMAT:
For each event, display:
1. Cover image (if exists): ![Event Title](coverImage)
2. Title and type (e.g., "Workshop", "Webinar")
3. Date and time with timezone
4. Location (for live) or "Online" (for online)
5. Status badge: 🔴 NOW, 🟡 TODAY, or date
6. Price if applicable
7. Share link: [🔗 View Event](shareLink) - ALWAYS include this!

DO NOT INVENT DATA:
- Use ONLY amounts, names, and counts from the context
- If data is missing, say "I don't have this information in the context"
- Never guess or make up numbers

You can:
- Show user's projects with funding status, goal, raised amount, percent funded, remaining
- List all donations received per project (who donated, when, how much, transaction ID)
- Search ALL active projects by title or creator name (ownerName)
- Compare funding progress across projects
- Tell user how many total active projects exist (totalActiveProjectsCount)
- List upcoming online and live events with details and share links
- Filter events by type, date, or status
- Show pending unconditional payments with all details

When user wants to pay, return ONLY JSON: {"action":"payment","recipient":"name","amount":100,"currency":"LANA","sourceWallet":"Main Wallet"}`;

const languagePrompts: Record<string, string> = {
  sl: `${baseSystemPrompt}\n\nOdgovarjaj v SLOVENŠČINI. Za iskanje med VSEMI projekti uporabi "allActiveProjects". Za prikaz UPORABNIKOVIH projektov uporabi "myProjects". Za evente uporabi "events.onlineEvents" in "events.liveEvents". Za unconditional payments uporabi "unconditionalPayments". VEDNO prikazi shareLink kot klikljivo povezavo.`,
  en: `${baseSystemPrompt}\n\nRespond in ENGLISH. Use "events.onlineEvents" and "events.liveEvents" for events. Use "unconditionalPayments" for pending payments. ALWAYS display shareLink as a clickable link.`,
  de: `${baseSystemPrompt}\n\nAntworte auf DEUTSCH. Verwende "events.onlineEvents" und "events.liveEvents" für Veranstaltungen. Verwende "unconditionalPayments" für ausstehende Zahlungen. Zeige shareLink IMMER als klickbaren Link an.`,
  hr: `${baseSystemPrompt}\n\nOdgovaraj na HRVATSKOM. Koristi "events.onlineEvents" i "events.liveEvents" za događaje. Koristi "unconditionalPayments" za tekuće uplate. UVIJEK prikaži shareLink kao klikabilnu poveznicu.`,
  hu: `${baseSystemPrompt}\n\nVálaszolj MAGYARUL. Használd az "events.onlineEvents" és "events.liveEvents" eseményekhez. Használd az "unconditionalPayments"-t a függőben lévő fizetésekhez. MINDIG jelenítsd meg a shareLink-et kattintható linkként.`,
  it: `${baseSystemPrompt}\n\nRispondi in ITALIANO. Usa "events.onlineEvents" e "events.liveEvents" per gli eventi. Usa "unconditionalPayments" per i pagamenti in sospeso. Mostra SEMPRE shareLink come link cliccabile.`,
  es: `${baseSystemPrompt}\n\nResponde en ESPAÑOL. Usa "events.onlineEvents" y "events.liveEvents" para eventos. Usa "unconditionalPayments" para pagos pendientes. SIEMPRE muestra shareLink como enlace clickeable.`,
  pt: `${baseSystemPrompt}\n\nResponda em PORTUGUÊS. Use "events.onlineEvents" e "events.liveEvents" para eventos. Use "unconditionalPayments" para pagamentos pendentes. SEMPRE exiba shareLink como link clicável.`,
};

function getSystemPrompt(lang: string): string {
  const langCode = (lang?.split('-')[0] || 'en').toLowerCase();
  return languagePrompts[langCode] || languagePrompts.en;
}

async function logUsage(
  nostrHexId: string, 
  model: string, 
  usage: { prompt_tokens: number; completion_tokens: number; total_tokens: number },
  usdToLanaRate: number
) {
  try {
    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
    );
    
    const costUsd = calculateCostUsd(model, usage.prompt_tokens || 0, usage.completion_tokens || 0);
    const costLana = costUsd * usdToLanaRate;
    
    await supabase.from('ai_usage_logs').insert({
      nostr_hex_id: nostrHexId,
      model: model,
      prompt_tokens: usage.prompt_tokens || 0,
      completion_tokens: usage.completion_tokens || 0,
      total_tokens: usage.total_tokens || 0,
      cost_usd: costUsd,
      cost_lana: costLana,
    });
    console.log(`Logged usage for ${nostrHexId}: ${usage.total_tokens} tokens, $${costUsd.toFixed(6)} USD, ${costLana.toFixed(4)} LANA`);
  } catch (err) {
    console.error("Failed to log usage:", err);
  }
}

// Patterns that indicate an unsupported or failed query
const UNSUPPORTED_PATTERNS = [
  /ne morem|nisem zmožen|ni mogoče|žal ne|tega ne podpiram/i,
  /cannot|can't|unable to|not able to|don't have|do not have|not supported/i,
  /keine.*unterstützung|nicht möglich|kann nicht/i,
  /ne mogu|nije moguće|ne podržavam/i,
  /nem tudom|nem lehetséges/i,
  /non posso|non è possibile/i,
  /no puedo|no es posible/i,
  /não posso|não é possível/i,
  /nimam.*podatkov|ni.*informacij|ni.*rezultatov/i,
  /no.*data|no.*information|no.*results/i,
];

function isUnsupportedResponse(response: string): boolean {
  // Check if response matches any unsupported pattern
  return UNSUPPORTED_PATTERNS.some(pattern => pattern.test(response));
}

async function logUnsupportedPrompt(
  nostrHexId: string,
  prompt: string,
  aiResponse: string,
  contextSummary: string
) {
  try {
    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
    );
    
    await supabase.from('ai_unsupported_prompts').insert({
      nostr_hex_id: nostrHexId,
      prompt: prompt,
      ai_response: aiResponse.substring(0, 2000), // Limit response length
      context_summary: contextSummary,
    });
    console.log(`Logged unsupported prompt for ${nostrHexId}: "${prompt.substring(0, 50)}..."`);
  } catch (err) {
    console.error("Failed to log unsupported prompt:", err);
  }
}

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const { messages, context, language, nostrHexId, usdToLanaRate } = await req.json();
    const LOVABLE_API_KEY = Deno.env.get("LOVABLE_API_KEY");
    if (!LOVABLE_API_KEY) throw new Error("AI service is not configured");

    let contextMessage = "";
    if (context) {
      contextMessage = `\n\nUSER DATA:\n${JSON.stringify(context, null, 2)}`;
    }

    const model = "google/gemini-3-flash-preview";
    
    const response = await fetch("https://ai.gateway.lovable.dev/v1/chat/completions", {
      method: "POST",
      headers: { Authorization: `Bearer ${LOVABLE_API_KEY}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        model,
        messages: [{ role: "system", content: getSystemPrompt(language) + contextMessage }, ...messages],
        stream: true,
        stream_options: { include_usage: true },
      }),
    });

    if (!response.ok) {
      return new Response(JSON.stringify({ error: "AI service error" }), {
        status: response.status,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Get the last user message for potential logging
    const lastUserMessage = messages.filter((m: any) => m.role === 'user').pop()?.content || '';
    
    // Create context summary for logging (limit size)
    const contextSummary = context ? JSON.stringify({
      hasWallets: !!context.wallets,
      walletCount: context.wallets?.count || 0,
      hasProjects: !!context.userProjects,
      myProjectsCount: context.userProjects?.projectCount || 0,
      allProjectsCount: context.userProjects?.totalActiveProjectsCount || 0,
    }) : '{}';

    // Hybrid streaming: forward to client while tracking usage and full response
    const reader = response.body!.getReader();
    const encoder = new TextEncoder();
    const decoder = new TextDecoder();
    
    let usageData: { prompt_tokens: number; completion_tokens: number; total_tokens: number } | null = null;
    let fullResponse = ''; // Collect full response for analysis

    const stream = new ReadableStream({
      async start(controller) {
        try {
          while (true) {
            const { done, value } = await reader.read();
            if (done) break;
            
            // Forward chunk to client
            controller.enqueue(value);
            
            // Parse for usage data and collect response
            const text = decoder.decode(value, { stream: true });
            const lines = text.split('\n');
            
            for (const line of lines) {
              if (line.startsWith('data: ') && !line.includes('[DONE]')) {
                try {
                  const json = JSON.parse(line.slice(6));
                  if (json.usage) {
                    usageData = json.usage;
                  }
                  // Collect response content
                  const content = json.choices?.[0]?.delta?.content;
                  if (content) {
                    fullResponse += content;
                  }
                } catch {
                  // Ignore parse errors for partial chunks
                }
              }
            }
          }
          
          controller.close();
          
          // Log usage after stream ends
          if (nostrHexId && usageData) {
            const rate = usdToLanaRate || 270; // Default fallback rate
            await logUsage(nostrHexId, model, usageData, rate);
          }
          
          // Check if response indicates unsupported query and log it
          if (nostrHexId && fullResponse && isUnsupportedResponse(fullResponse)) {
            await logUnsupportedPrompt(nostrHexId, lastUserMessage, fullResponse, contextSummary);
          }
        } catch (err) {
          console.error("Stream error:", err);
          controller.error(err);
        }
      }
    });

    return new Response(stream, { headers: { ...corsHeaders, "Content-Type": "text/event-stream" } });
  } catch (error) {
    return new Response(JSON.stringify({ error: error instanceof Error ? error.message : "Unknown error" }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
