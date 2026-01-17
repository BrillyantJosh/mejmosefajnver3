import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

const languagePrompts: Record<string, string> = {
  sl: `Ti si AI svetovalec za Lana ekosistem. Odgovarjaj v SLOVENŠČINI. Ko uporabnik želi plačati, vrni SAMO JSON: {"action":"payment","recipient":"ime","amount":100,"currency":"LANA","sourceWallet":"Main Wallet"}`,
  en: `You are an AI advisor for the Lana ecosystem. Respond in ENGLISH. When user wants to pay, return ONLY JSON: {"action":"payment","recipient":"name","amount":100,"currency":"LANA","sourceWallet":"Main Wallet"}`,
  de: `Du bist ein KI-Berater für das Lana-Ökosystem. Antworte auf DEUTSCH. Wenn der Benutzer zahlen möchte, gib NUR JSON zurück: {"action":"payment","recipient":"name","amount":100,"currency":"LANA","sourceWallet":"Main Wallet"}`,
  hr: `Ti si AI savjetnik za Lana ekosustav. Odgovaraj na HRVATSKOM. Kada korisnik želi platiti, vrati SAMO JSON: {"action":"payment","recipient":"ime","amount":100,"currency":"LANA","sourceWallet":"Main Wallet"}`,
  hu: `Te egy AI tanácsadó vagy a Lana ökoszisztémához. Válaszolj MAGYARUL. Ha a felhasználó fizetni szeretne, CSAK JSON-t adj vissza: {"action":"payment","recipient":"név","amount":100,"currency":"LANA","sourceWallet":"Main Wallet"}`,
  it: `Sei un consulente AI per l'ecosistema Lana. Rispondi in ITALIANO. Quando l'utente vuole pagare, restituisci SOLO JSON: {"action":"payment","recipient":"nome","amount":100,"currency":"LANA","sourceWallet":"Main Wallet"}`,
  es: `Eres un asesor de IA para el ecosistema Lana. Responde en ESPAÑOL. Cuando el usuario quiera pagar, devuelve SOLO JSON: {"action":"payment","recipient":"nombre","amount":100,"currency":"LANA","sourceWallet":"Main Wallet"}`,
  pt: `Você é um consultor de IA para o ecossistema Lana. Responda em PORTUGUÊS. Quando o usuário quiser pagar, retorne APENAS JSON: {"action":"payment","recipient":"nome","amount":100,"currency":"LANA","sourceWallet":"Main Wallet"}`,
};

function getSystemPrompt(lang: string): string {
  const langCode = (lang?.split('-')[0] || 'en').toLowerCase();
  return languagePrompts[langCode] || languagePrompts.en;
}

async function logUsage(nostrHexId: string, model: string, usage: { prompt_tokens: number; completion_tokens: number; total_tokens: number }) {
  try {
    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
    );
    
    await supabase.from('ai_usage_logs').insert({
      nostr_hex_id: nostrHexId,
      model: model,
      prompt_tokens: usage.prompt_tokens || 0,
      completion_tokens: usage.completion_tokens || 0,
      total_tokens: usage.total_tokens || 0,
    });
    console.log(`Logged usage for ${nostrHexId}: ${usage.total_tokens} tokens`);
  } catch (err) {
    console.error("Failed to log usage:", err);
  }
}

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const { messages, context, language, nostrHexId } = await req.json();
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

    // Hybrid streaming: forward to client while tracking usage
    const reader = response.body!.getReader();
    const encoder = new TextEncoder();
    const decoder = new TextDecoder();
    
    let usageData: { prompt_tokens: number; completion_tokens: number; total_tokens: number } | null = null;

    const stream = new ReadableStream({
      async start(controller) {
        try {
          while (true) {
            const { done, value } = await reader.read();
            if (done) break;
            
            // Forward chunk to client
            controller.enqueue(value);
            
            // Parse for usage data
            const text = decoder.decode(value, { stream: true });
            const lines = text.split('\n');
            
            for (const line of lines) {
              if (line.startsWith('data: ') && !line.includes('[DONE]')) {
                try {
                  const json = JSON.parse(line.slice(6));
                  if (json.usage) {
                    usageData = json.usage;
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
            await logUsage(nostrHexId, model, usageData);
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
