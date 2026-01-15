import { serve } from "https://deno.land/std@0.168.0/http/server.ts";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

const systemPrompt = `Ti si AI svetovalec za Lana ekosistem. Uporabnik ti bo zastavil vprašanja o svojem finančnem stanju v Lana sistemu.

KONTEKST O LANA8WONDER:
- Lana8Wonder je annuity (renta) plan, ki uporabniku omogoča postopno izplačevanje LANA kovancev
- Vsak account ima več "nivojev" (levels), vsak nivo ima trigger_price
- Ko trenutna cena (currentPrice) preseže trigger_price nivoja, postane ta nivo "triggered"
- Uporabnik mora izvesti "cash out" če je balance > remaining_lanas za triggered nivo
- Cash out pomeni prenesti presežek LANA na drug wallet

KONTEKST O UNCONDITIONAL PAYMENTS:
- To so plačila, ki jih uporabnik prejme neposredno
- Pending proposals so čakajoča plačila, ki še niso bila izplačana
- Paid payments so že izplačana plačila

KONTEKST O UNPAID LASHES:
- LASH so mali zneski LANA, ki jih uporabniki pošiljajo drug drugemu
- Unpaid lashes so tisti, ki še niso bili plačani

KONTEKST O WALLETS:
- Uporabnik ima lahko več denarnic (wallets)
- Vsaka denarnica ima balance v LANA
- Lahko ima tudi fiat vrednost (EUR, USD)

NAVODILA:
1. Odgovori jasno, prijazno in jedrnato v slovenščini ali angleščini (odvisno od vprašanja uporabnika)
2. Če uporabnik vpraša koliko mora izplačati, izračunaj in pojasni
3. Če podatkov ni ali so prazni, to jasno povej
4. Uporabi konkretne številke iz konteksta
5. Predlagaj naslednje korake, če je smiselno (npr. "Pojdi na Lana8Wonder stran...")
6. Bodi prijazen in pomagaj uporabniku razumeti njegovo stanje`;

serve(async (req) => {
  // Handle CORS preflight requests
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const { messages, context } = await req.json();
    
    const LOVABLE_API_KEY = Deno.env.get("LOVABLE_API_KEY");
    if (!LOVABLE_API_KEY) {
      console.error("LOVABLE_API_KEY is not configured");
      throw new Error("AI service is not configured");
    }

    // Build context message
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

    const fullSystemPrompt = systemPrompt + contextMessage;
    
    console.log("Calling Lovable AI Gateway with context");

    const response = await fetch("https://ai.gateway.lovable.dev/v1/chat/completions", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${LOVABLE_API_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: "google/gemini-3-flash-preview",
        messages: [
          { role: "system", content: fullSystemPrompt },
          ...messages,
        ],
        stream: true,
      }),
    });

    if (!response.ok) {
      if (response.status === 429) {
        console.error("Rate limit exceeded");
        return new Response(JSON.stringify({ error: "Rate limits exceeded, please try again later." }), {
          status: 429,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
      if (response.status === 402) {
        console.error("Payment required");
        return new Response(JSON.stringify({ error: "AI service requires payment. Please contact support." }), {
          status: 402,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
      const errorText = await response.text();
      console.error("AI gateway error:", response.status, errorText);
      return new Response(JSON.stringify({ error: "AI service error" }), {
        status: 500,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Stream the response back
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
