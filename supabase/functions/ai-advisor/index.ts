import { serve } from "https://deno.land/std@0.168.0/http/server.ts";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

const systemPrompt = `Ti si AI svetovalec za Lana ekosistem. Uporabnik ti bo zastavil vprašanja o svojem finančnem stanju v Lana sistemu.

KONTEKST O DENARNICAH (WALLETS):
- Uporabnik ima lahko več denarnic različnih tipov
- Tipi: "Main Wallet" (glavna), "Wallet" (običajna), "LanaPays.Us", "Knights", "Lana8Wonder"
- Za pošiljanje LANA lahko uporabnik uporabi samo "Main Wallet" ali "Wallet" tip

POŠILJANJE PLAČIL:
Ko uporabnik izrazi željo po plačilu, vrni SAMO JSON v tej obliki:
{"action":"payment","recipient":"ime","amount":100,"currency":"LANA","sourceWallet":"Main Wallet"}

Primeri:
- "Plačaj Borisu 50 LANA" → {"action":"payment","recipient":"Boris","amount":50,"currency":"LANA","sourceWallet":"Main Wallet"}
- "Pošlji Ani 100 LANA" → {"action":"payment","recipient":"Ana","amount":100,"currency":"LANA","sourceWallet":"Main Wallet"}

NAVODILA:
1. Odgovori jasno in prijazno v slovenščini ali angleščini
2. Za stanja uporabi podatke iz wallets.details
3. Če zaznaš intent za plačilo, vrni SAMO JSON brez razlage`;

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const { messages, context } = await req.json();
    
    const LOVABLE_API_KEY = Deno.env.get("LOVABLE_API_KEY");
    if (!LOVABLE_API_KEY) {
      throw new Error("AI service is not configured");
    }

    let contextMessage = "";
    if (context) {
      contextMessage = `\n\nTRENUTNI PODATKI UPORABNIKA:\n`;
      if (context.wallets) {
        contextMessage += `\nWALLETS:\n${JSON.stringify(context.wallets, null, 2)}`;
      }
      if (context.lana8Wonder) {
        contextMessage += `\nLANA8WONDER:\n${JSON.stringify(context.lana8Wonder, null, 2)}`;
      }
      if (context.pendingPayments) {
        contextMessage += `\nPENDING PAYMENTS:\n${JSON.stringify(context.pendingPayments, null, 2)}`;
      }
      if (context.unpaidLashes) {
        contextMessage += `\nUNPAID LASHES:\n${JSON.stringify(context.unpaidLashes, null, 2)}`;
      }
    }

    const response = await fetch("https://ai.gateway.lovable.dev/v1/chat/completions", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${LOVABLE_API_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: "google/gemini-3-flash-preview",
        messages: [
          { role: "system", content: systemPrompt + contextMessage },
          ...messages,
        ],
        stream: true,
      }),
    });

    if (!response.ok) {
      if (response.status === 429) {
        return new Response(JSON.stringify({ error: "Rate limits exceeded" }), {
          status: 429,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
      return new Response(JSON.stringify({ error: "AI service error" }), {
        status: 500,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    return new Response(response.body, {
      headers: { ...corsHeaders, "Content-Type": "text/event-stream" },
    });
  } catch (error) {
    console.error("AI advisor error:", error);
    return new Response(JSON.stringify({ error: error instanceof Error ? error.message : "Unknown error" }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
