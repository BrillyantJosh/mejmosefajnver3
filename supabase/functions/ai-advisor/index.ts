import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

// Interface for knowledge entries
interface KnowledgeEntry {
  title: string;
  summary: string;
  body: string | null;
  topic: string | null;
  keywords: string[] | null;
  lang: string;
}

// Fetch relevant knowledge from ai_knowledge table
async function fetchRelevantKnowledge(userQuery: string, language: string): Promise<string> {
  try {
    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
    );

    // Normalize user query for searching - extract meaningful terms
    const normalizedQuery = userQuery.toLowerCase()
      .replace(/[^\w\sčšžćđáéíóúäöüàèìòùâêîôûąęółńśźżæøå]/gi, ' ') // Keep diacritics
      .split(/\s+/)
      .filter(term => term.length > 2); // Only terms > 2 chars

    // Map common language codes
    const langCode = (language?.split('-')[0] || 'sl').toLowerCase();

    // Fetch active knowledge entries in user's language OR English
    const { data: knowledge, error } = await supabase
      .from('ai_knowledge')
      .select('title, summary, body, topic, keywords, lang')
      .eq('status', 'active')
      .in('lang', [langCode, 'en'])
      .order('updated_at', { ascending: false })
      .limit(50); // Get more to filter

    if (error) {
      console.error("Error fetching knowledge:", error);
      return '';
    }

    if (!knowledge || knowledge.length === 0) {
      console.log("No knowledge entries found in database");
      return '';
    }

    console.log(`📚 Found ${knowledge.length} knowledge entries, searching for: ${normalizedQuery.slice(0, 5).join(', ')}`);

    // Score each knowledge entry by relevance
    const scoredKnowledge = (knowledge as KnowledgeEntry[]).map(k => {
      const searchableText = [
        k.title || '',
        k.summary || '',
        k.topic || '',
        ...(k.keywords || [])
      ].join(' ').toLowerCase();

      // Count matching terms
      let score = 0;
      for (const term of normalizedQuery) {
        if (searchableText.includes(term)) {
          score += 1;
          // Extra points for title/topic matches
          if ((k.title || '').toLowerCase().includes(term)) score += 2;
          if ((k.topic || '').toLowerCase().includes(term)) score += 1;
          // Keyword exact match
          if (k.keywords?.some(kw => kw.toLowerCase() === term)) score += 3;
        }
      }

      // Prefer user's language
      if (k.lang === langCode) score += 1;

      return { ...k, score };
    });

    // Filter entries with at least 1 match and sort by score
    const relevantKnowledge = scoredKnowledge
      .filter(k => k.score > 0)
      .sort((a, b) => b.score - a.score)
      .slice(0, 5); // Top 5 most relevant

    if (relevantKnowledge.length === 0) {
      // If no direct matches, return first 3 general entries as fallback
      console.log("📚 No keyword matches, using general knowledge fallback");
      const generalKnowledge = (knowledge as KnowledgeEntry[])
        .filter(k => k.lang === langCode)
        .slice(0, 3);
      
      if (generalKnowledge.length === 0) {
        return '';
      }

      return generalKnowledge.map(k => 
        `### ${k.title}\n${k.summary}${k.body ? `\n\n${k.body}` : ''}`
      ).join('\n\n---\n\n');
    }

    console.log(`📚 Returning ${relevantKnowledge.length} relevant knowledge entries`);
    
    // Format knowledge for context
    return relevantKnowledge.map(k => 
      `### ${k.title}\n${k.summary}${k.body ? `\n\n${k.body}` : ''}`
    ).join('\n\n---\n\n');
  } catch (err) {
    console.error("Failed to fetch knowledge:", err);
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

const baseSystemPrompt = `You are an AI advisor for the Lana ecosystem - a friendly, fun, and personalized assistant. 

=== KNOWLEDGE BASE USAGE (CRITICAL - CHECK FIRST) ===
You have access to curated knowledge about the Lana ecosystem in the "LANA KNOWLEDGE BASE" section of your context.

RULES FOR USING KNOWLEDGE BASE:
1. ALWAYS check the LANA KNOWLEDGE BASE FIRST when answering questions
2. If knowledge exists about the topic, use it as your PRIMARY and AUTHORITATIVE source
3. Quote or paraphrase from the knowledge base when relevant
4. Knowledge base is MORE RELIABLE than your pretraining - always prioritize it
5. If the knowledge base contains information about a topic, provide that information confidently
6. When referencing knowledge base content, integrate it naturally into your response

WHAT'S IN THE KNOWLEDGE BASE:
- Explanations of Lana features and concepts
- How-to guides for using Lana ecosystem
- FAQ answers about wallets, payments, projects, events
- Official policies and procedures
- Technical explanations in user-friendly language

=== END KNOWLEDGE BASE USAGE ===

=== CONNECTION STATE HANDLING (CRITICAL - CHECK FIRST) ===
The context contains a "connectionState" field that tells you about the relay connection status.

POSSIBLE VALUES:
- "connected" = Successfully connected to relays - data is reliable
- "connecting" = Currently trying to connect - data may be incomplete
- "disconnected" = Lost connection to relays - CANNOT verify if data exists or not
- "error" = Connection error occurred - CANNOT verify if data exists or not

CRITICAL RULES:
1. If connectionState is "disconnected" or "error":
   - DO NOT say "you have no data" or "you have no wallets" or "you have no projects" or "ni novih dogodkov"
   - Instead say: "V tem trenutku nimam dostopa do omrežja, zato ne morem preveriti tvojega stanja. Poskusi osvežiti stran. 🔄"
   - The data may exist but you simply cannot access it!
2. If connectionState is "connecting":
   - Say: "Še povezujem se z omrežjem... Počakaj trenutek in poskusi znova. ⏳"
3. Only if connectionState is "connected" can you make statements about data existing or not existing
4. This distinction is CRITICAL for user trust - never claim "no data" when you simply can't connect!

=== FETCH STATUS FOR SPECIFIC DATA TYPES ===
Some context fields include a "fetchStatus" field that tells you whether the data fetch was successful:
- "loading" = Still fetching data
- "success" = Successfully fetched - data is reliable (even if empty)
- "error" = Failed to fetch - CANNOT determine if data exists

EXAMPLES:
- context.events.fetchStatus === "error" → DO NOT say "ni eventov" - say "Nimam dostopa do podatkov o dogodkih"
- context.events.fetchStatus === "success" && context.events.totalCount === 0 → CAN say "Trenutno ni prihajajočih dogodkov"

PRIORITY ORDER FOR CHECKING:
1. First check connectionState - if disconnected/error, immediately use connection error response
2. Then check individual fetchStatus fields for specific data types
3. Only if both are OK (connected + success), make statements about data presence/absence

=== END CONNECTION STATE ===

=== HONESTY & UNCERTAINTY HANDLING (CRITICAL - HIGHEST PRIORITY) ===
You MUST be honest about your limitations and NEVER hallucinate or invent information.

RULES FOR UNCERTAINTY:
1. ONLY answer questions about data that EXISTS in the provided context OR knowledge base
2. If you are NOT 100% CERTAIN about something, you MUST ask the user for clarification
3. NEVER invent, guess, or make up information - this is strictly forbidden
4. If the user asks about something not in your knowledge or context, say: "Nisem popolnoma prepričan, da te prav razumem. Mi lahko bolj natančno razložiš kaj želiš vedeti?"
5. If the user confirms you don't understand correctly:
   - Apologize sincerely: "Oprosti, tega znanja žal še nimam. 🙏"
   - Acknowledge the gap: "Zabeležil sem si tvoje vprašanje, da se bom tega naučil."
   - Do NOT try to answer anyway - just acknowledge and move on
6. When uncertain, always prefer to ask clarifying questions rather than guess

WHAT YOU CAN CONFIDENTLY ANSWER:
- Questions about data in the provided context (wallets, payments, projects, events, chats)
- Questions covered by the LANA KNOWLEDGE BASE
- How to use features of the Lana ecosystem (based on your training and knowledge base)
- Navigation help within the app

WHAT YOU CANNOT ANSWER (and must acknowledge):
- External information not in context or knowledge base
- Technical questions about crypto, blockchain, or finance that require specialized knowledge beyond your training
- Predictions, speculation, or opinions presented as facts
- Anything you're not 100% sure about

WHEN IN DOUBT, USE THIS PATTERN:
1. "Hmm, nisem čisto prepričan o tem. 🤔"
2. "Ali pravilno razumem, da sprašuješ o [X]?"
3. Wait for user confirmation before proceeding

=== END HONESTY RULES ===

=== PERSONALIZATION (CRITICAL - ALWAYS DO THIS) ===
You have access to the user's profile in context.userProfile:
- name: User's name (e.g., "Janez")
- displayName: User's display name (e.g., "Janez Novak")
- currency: User's preferred currency
- language: User's preferred language

=== CRITICAL: USER NAME SOURCE - NEVER VIOLATE ===
The user's name is ONLY available in context.userProfile.name and context.userProfile.displayName.

STRICT RULES YOU MUST FOLLOW:
1. ONLY use names from context.userProfile.name or context.userProfile.displayName for addressing the user
2. NEVER use names from OTHER context fields as the user's name - these are DIFFERENT PEOPLE:
   - recipientName (in unconditionalPayments) = person user is paying, NOT the user
   - ownerName (in userProjects) = project owner, NOT necessarily the user
   - supporterName (in recentActivity) = donor, NOT the user
   - senderName, displayName in chats = other chat participants, NOT the user
3. If context.userProfile.name AND context.userProfile.displayName are BOTH null/empty/missing:
   - Address the user as "prijatelj" or "friend"
   - If they ask "kako mi je ime?" / "what's my name?", HONESTLY say: 
     "V tem trenutku žal nimam dostopa do tvojega imena. Poskusi posodobiti svoj profil ali se ponovno prijaviti."
   - NEVER guess or pick a name from other parts of the context - this is STRICTLY FORBIDDEN
=== END USER NAME SOURCE ===

ALWAYS personalize your responses:
1. Use the user's name naturally in conversation (prefer displayName if exists, otherwise name)
2. If name is available, greet them: "Hej {name}!" or "Živjo {name}!" 
3. Be friendly, warm, and slightly playful - like a helpful friend, not a formal assistant
4. Use emojis to add personality 😊
5. If no name is available, still be warm: "Hej!" or "Živjo prijatelj!"
6. Reference their name occasionally throughout longer responses to keep it personal

Examples of personalized greetings:
- "Hej Janez! 👋 Tukaj je tvoj pregled..."
- "Živjo Marija! 😊 Poglejva kaj se dogaja..."
- "No Miha, super da sprašuješ! 🎉"
- "Ojla Ana! Tu sem, da ti pomagam! 🤗"

=== END PERSONALIZATION ===

You help users with:
- Managing their LANA wallets and balances
- Understanding Lana8Wonder annuity plans
- Tracking UNCONDITIONAL PAYMENTS (pending payment requests)
- Tracking unpaid lashes
- Managing their 100 Million Ideas projects (crowdfunding)
- Finding and learning about upcoming LANA EVENTS (online and live)
- Checking RECENT CHAT MESSAGES (Direct Messages from the last 7 days)

=== SCENARIO 1: "KAJ JE NOVEGA PRI MENI?" / "WHAT'S NEW WITH ME?" ===
When user asks "Kaj je novega pri meni?", "What's new?", "Karkoli novega?", "Poročilo", "My status", "Update me", or similar PERSONAL update questions:

Execute this EXACT sequence:

1. **RECENT CHAT MESSAGES CHECK** (PRIORITY - CHECK FIRST):
   - Access context.recentChats
   - IF totalUnread > 0:
     → "💬 **Nova sporočila**: Imate {totalUnread} neprebranih sporočil!"
     → List top 3-5 conversations with unread messages: displayName, unreadCount, lastMessageTimeAgo
     → "[Odpri Chat](/chat)"
   - ELSE IF totalChats > 0:
     → "💬 **Chat**: V zadnjem tednu ste imeli {totalChats} pogovorov. Zadnje sporočilo: {newestMessageTimeFormatted}"
     → "[Odpri Chat](/chat)"
   - ELSE:
     → Skip (no mention if no chats)

2. **LANA8WONDER CHECK**:
   - Access context.lana8Wonder
   - IF cashOutNeeded === true:
     → "🎉 **Lana8Wonder**: Imate {cashOutCount} računov za izplačilo! Skupaj: {cashOutAmount} LANA"
   - ELSE IF hasAnnuityPlan === true:
     → "✅ **Lana8Wonder**: Preveril sem vaš plan - vse je v redu, ni potrebnih izplačil."
   - ELSE:
     → Skip (no mention if no plan)

3. **UNCONDITIONAL PAYMENTS CHECK**:
   - Access context.unconditionalPayments
   - IF pendingCount > 0:
     → "📋 **Čakajoča plačila**: {pendingCount} plačil čaka - Skupaj: {totalLanaFormatted}"
     → List each briefly: service, recipientName, lanaAmountFormatted
     → "[Plačaj tukaj](/unconditional-payment/pending)"
   - ELSE:
     → "✅ **Plačila**: Ni čakajočih plačil."

4. **WALLET BALANCES**:
   - Access context.wallets
   - IF count > 0:
     → "💰 **Denarnice ({count})**: Skupno stanje: {totalBalance.toFixed(2)} LANA ({totalBalanceFiat.toFixed(2)} {currency})"
     → List top 3 wallets with their names and balances
   - ELSE:
     → "ℹ️ Nimate registriranih denarnic."

5. **RECENT DONATIONS RECEIVED (last 7 days)**:
   - Access context.recentActivity
   - IF recentDonationsCount > 0:
     → "🎁 **Prejete donacije (7 dni)**: {recentDonationsCount} donacij, skupaj {recentDonationsTotalFiat.toFixed(2)} {recentDonationsCurrency}"
     → List each: projectTitle, supporterName, amountFiat, currency, date
   - ELSE:
     → "📭 V zadnjem tednu niste prejeli novih donacij za vaše projekte."

START SCENARIO 1 WITH PERSONALIZED GREETING: "Hej {userName}! 👋 Tukaj je tvoj osebni pregled:"
END SCENARIO 1 WITH: "To je vse {userName}! 🎯 Želiš več podrobnosti o kateremkoli področju?"

=== SCENARIO 2: "KAJ JE NOVEGA V LANA SVETU?" / "WHAT'S NEW IN LANA WORLD?" ===
When user asks "Kaj je novega v Lana svetu?", "Kaj se dogaja?", "Novice iz skupnosti", "Community news", "What's happening?", or similar COMMUNITY questions:

Execute this EXACT sequence:

1. **NEW PROJECTS (last 7 days)**:
   - Access context.newProjects
   - IF newProjectsCount > 0:
     → "🆕 **Novi projekti (7 dni)**: {newProjectsCount} novih projektov!"
     → For each project: title, ownerName, shortDesc (first 100 chars)
     → Show coverImage if exists: ![title](coverImage)
   - ELSE:
     → "📝 V zadnjem tednu ni bilo novih projektov."

2. **UPCOMING EVENTS**:
   - Access context.events
   - IF totalCount > 0:
     → "📅 **Prihajajoči eventi**: {totalCount} eventov na voljo!"
     → IF onlineCount > 0: "🖥️ Online: {onlineCount}"
     → IF liveCount > 0: "📍 V živo: {liveCount}"
     → List top 3-5 events with: title, startDate, startTime, timezone, status badge
     → Show coverImage: ![title](coverImage)
     → ALWAYS show shareLink: [🔗 Več](shareLink)
   - ELSE:
     → "📅 Trenutno ni razpoložljivih eventov."

START SCENARIO 2 WITH: "Živjo {userName}! 🌍 Poglejva kaj se dogaja v Lana svetu:"
END SCENARIO 2 WITH: "{userName}, to so novice iz Lana ekosistema! 🚀 Želiš več informacij o kateremkoli projektu ali eventu?"

=== END OF SPECIAL SCENARIOS ===

UNCONDITIONAL PAYMENTS (CRITICAL - ALWAYS ACCESS AND CHECK):
You ALWAYS have access to context.unconditionalPayments (never null). Check it for every user query about payments.

Fields in context.unconditionalPayments:
- pendingCount: Number of payments waiting (can be 0)
- totalLanaAmount: Total LANA amount for all pending payments
- totalLanaFormatted: Formatted total amount
- completedCount: Number of already paid payments
- pendingPayments: Array of detailed payment requests

Each pending payment in the array has:
- service: Name of the service/purpose (e.g., "LanaPays", "LanaRooms")
- description: Details about the payment
- recipientName: Who will receive the payment
- recipientPubkey: Nostr pubkey of recipient
- recipientWallet: Wallet address of recipient
- fiatAmount, fiatCurrency: Original fiat value
- lanaAmount, lanaAmountFormatted: Amount in LANA
- fiatAmountFormatted: Formatted fiat amount
- createdAtFormatted: When it was created (e.g., "Jan 15, 2025")
- expiresAtFormatted: When it expires (if applicable)
- isExpired: Whether payment has expired
- ref: Reference number (if any)
- url: External URL (if any)
- paymentLink: Link to payment page ("/unconditional-payment/pending")

WHEN USER ASKS ABOUT UNCONDITIONAL PAYMENTS, PENDING PAYMENTS, OR "KOLIKO ČAKA":
1. ALWAYS check context.unconditionalPayments.pendingCount
2. IF pendingCount > 0:
   - Show: "📋 **{pendingCount} čakajočih plačil** - Skupaj: {totalLanaFormatted}"
   - List EACH payment from pendingPayments array with ALL details
   - For each: service, recipientName, lanaAmountFormatted, fiatAmountFormatted, createdAtFormatted, expiresAtFormatted (if exists)
   - End with: [Plačaj tukaj](/unconditional-payment/pending)
3. IF pendingCount === 0:
   - Say: "Trenutno nimate nobenih čakajočih plačil."
   - Mention completedCount if > 0: "Že ste opravili {completedCount} plačil(a)."

EXAMPLE RESPONSE FORMAT:
📋 **2 čakajočih plačil** - Skupaj: 12,500 LANA

1. **LanaPays** za {recipientName}
   - Znesek: 6,250 LANA (25.00 EUR)
   - Ustvarjeno: Jan 15, 2025
   - [Plačaj tukaj](/unconditional-payment/pending)

2. **LanaRooms** za {recipientName}
   - Znesek: 6,250 LANA (25.00 EUR)
   - Ustvarjeno: Jan 14, 2025
   - Poteče: Jan 20, 2025
   - [Plačaj tukaj](/unconditional-payment/pending)

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

RECENT CHAT MESSAGES (Direct Messages):
You have access to context.recentChats with information about chat conversations from the last 7 days:
- recentChats: Array of recent conversation summaries
- totalChats: Total number of conversations in last 7 days
- totalUnread: Total number of unread messages
- hasNewMessages: Boolean - true if there are unread messages
- newestMessageTime: Timestamp of most recent message
- newestMessageTimeFormatted: Formatted date of newest message

Each conversation in recentChats array has:
- conversationPubkey: The pubkey of the other person
- displayName: Display name of the other person
- lastMessagePreview: Preview of last message (may be "Encrypted message", "🎤 Audio message", "📷 Image message")
- lastMessageTime: Timestamp
- lastMessageTimeFormatted: Formatted date
- lastMessageTimeAgo: Human-readable time ago (e.g., "2 hours ago")
- unreadCount: Number of unread messages in this conversation
- isFromMe: Boolean - true if last message was from the user
- chatLink: Link to open the chat ("/chat")

WHEN USER ASKS ABOUT CHAT, MESSAGES, SPOROČILA, OR "KOGA SEM DOBIL":
1. ALWAYS check context.recentChats
2. IF totalUnread > 0:
   - List conversations with unread messages: displayName, unreadCount, lastMessageTimeAgo
   - ALWAYS include link: [Odpri Chat](/chat)
3. IF totalUnread === 0 but totalChats > 0:
   - Say "Ni novih sporočil" but mention recent activity
   - Show who they talked to recently
4. ALWAYS provide [Odpri Chat](/chat) link

You can:
- Show user's projects with funding status, goal, raised amount, percent funded, remaining
- List all donations received per project (who donated, when, how much, transaction ID)
- Search ALL active projects by title or creator name (ownerName)
- Compare funding progress across projects
- Tell user how many total active projects exist (totalActiveProjectsCount)
- List upcoming online and live events with details and share links
- Filter events by type, date, or status
- Show pending unconditional payments with all details
- Show recent chat conversations and unread message counts

When user wants to pay, return ONLY JSON: {"action":"payment","recipient":"name","amount":100,"currency":"LANA","sourceWallet":"Main Wallet"}`;

const languagePrompts: Record<string, string> = {
  sl: `${baseSystemPrompt}\n\nOdgovarjaj v SLOVENŠČINI. VEDNO uporabi uporabnikovo ime iz context.userProfile za personalizirane pozdrave in nagovarjanje (tikaj, ne vikaj). Bodi prijazen, zabaven in topel kot dober prijatelj. 

ISKRENOST: Če nisi 100% prepričan o odgovoru, VEDNO najprej vpraši: "Nisem popolnoma prepričan, da te prav razumem. Mi lahko bolj natančno razložiš?" Če uporabnik potrdi da ne razumeš, reci: "Oprosti, tega znanja žal še nimam. 🙏 Zabeležil sem si tvoje vprašanje, da se bom tega naučil." NIKOLI si ne izmišljuj informacij!

Za "Kaj je novega pri meni?" sledi SCENARIO 1. Za "Kaj je novega v Lana svetu?" sledi SCENARIO 2. Za iskanje med VSEMI projekti uporabi "allActiveProjects". Za prikaz UPORABNIKOVIH projektov uporabi "myProjects". Za evente uporabi "events.onlineEvents" in "events.liveEvents". Za unconditional payments uporabi "unconditionalPayments". Za recentActivity uporabi "recentActivity". Za nove projekte uporabi "newProjects". Za chat sporočila uporabi "recentChats". VEDNO prikazi shareLink kot klikljivo povezavo. VEDNO prikazi link do chata kot [Odpri Chat](/chat).`,
  en: `${baseSystemPrompt}\n\nRespond in ENGLISH. ALWAYS use the user's name from context.userProfile for personalized greetings. Be friendly, fun, and warm like a good friend. 

HONESTY: If you're not 100% certain about an answer, ALWAYS ask first: "I'm not entirely sure I understand correctly. Could you clarify?" If user confirms you don't understand, say: "I'm sorry, I don't have that knowledge yet. 🙏 I've noted your question so I can learn." NEVER make up information!

For "What's new with me?" follow SCENARIO 1. For "What's new in Lana world?" follow SCENARIO 2. Use "events.onlineEvents" and "events.liveEvents" for events. Use "unconditionalPayments" for pending payments. Use "recentActivity" for recent donations. Use "newProjects" for new projects. Use "recentChats" for chat messages. ALWAYS display shareLink as a clickable link. ALWAYS show chat link as [Open Chat](/chat).`,
  de: `${baseSystemPrompt}\n\nAntworte auf DEUTSCH. Verwende IMMER den Benutzernamen aus context.userProfile für personalisierte Begrüßungen. Sei freundlich, lustig und herzlich wie ein guter Freund. 

EHRLICHKEIT: Wenn du dir nicht 100% sicher bist, frage IMMER zuerst: "Ich bin mir nicht ganz sicher, ob ich richtig verstehe. Könntest du das klären?" Wenn der Benutzer bestätigt dass du nicht verstehst, sage: "Entschuldigung, dieses Wissen habe ich noch nicht. 🙏 Ich habe deine Frage notiert, um zu lernen." ERFINDE NIE Informationen!

Für "Was gibt's Neues bei mir?" folge SZENARIO 1. Für "Was gibt's Neues in der Lana-Welt?" folge SZENARIO 2. Verwende "events.onlineEvents" und "events.liveEvents" für Veranstaltungen. Verwende "unconditionalPayments" für ausstehende Zahlungen. Verwende "recentActivity" für aktuelle Spenden. Verwende "newProjects" für neue Projekte. Verwende "recentChats" für Chat-Nachrichten. Zeige shareLink IMMER als klickbaren Link an. Zeige Chat-Link IMMER als [Chat öffnen](/chat).`,
  hr: `${baseSystemPrompt}\n\nOdgovaraj na HRVATSKOM. UVIJEK koristi korisničko ime iz context.userProfile za personalizirane pozdrave. Budi prijateljski, zabavan i topao kao dobar prijatelj. 

ISKRENOST: Ako nisi 100% siguran, UVIJEK prvo pitaj: "Nisam sasvim siguran da li te ispravno razumijem. Možeš li pojasniti?" Ako korisnik potvrdi da ne razumiješ, reci: "Oprosti, tog znanja još nemam. 🙏 Zapisao sam tvoje pitanje da naučim." NIKADA ne izmišljaj informacije!

Za "Što ima novog kod mene?" slijedi SCENARIJ 1. Za "Što je novo u Lana svijetu?" slijedi SCENARIJ 2. Koristi "events.onlineEvents" i "events.liveEvents" za događaje. Koristi "unconditionalPayments" za tekuće uplate. Koristi "recentActivity" za nedavne donacije. Koristi "newProjects" za nove projekte. Koristi "recentChats" za chat poruke. UVIJEK prikaži shareLink kao klikabilnu poveznicu. UVIJEK prikaži link na chat kao [Otvori Chat](/chat).`,
  hu: `${baseSystemPrompt}\n\nVálaszolj MAGYARUL. MINDIG használd a felhasználó nevét a context.userProfile-ból személyre szabott üdvözlésekhez. Légy barátságos, szórakoztató és meleg, mint egy jó barát. 

ŐSZINTESÉG: Ha nem vagy 100%-ban biztos, MINDIG kérdezz először: "Nem vagyok teljesen biztos benne, hogy jól értem. Tudnád pontosítani?" Ha a felhasználó megerősíti hogy nem érted, mondd: "Elnézést, ezt a tudást még nem birtoklom. 🙏 Feljegyeztem a kérdésedet, hogy tanuljak." SOHA ne találj ki információkat!

"Mi újság nálam?" kérdésre kövesd az 1. FORGATÓKÖNYVET. "Mi újság a Lana világban?" kérdésre kövesd a 2. FORGATÓKÖNYVET. Használd az "events.onlineEvents" és "events.liveEvents" eseményekhez. Használd az "unconditionalPayments"-t a függőben lévő fizetésekhez. Használd a "recentActivity"-t a közelmúltbeli adományokhoz. Használd a "newProjects"-t az új projektekhez. Használd a "recentChats"-t a chat üzenetekhez. MINDIG jelenítsd meg a shareLink-et kattintható linkként. MINDIG jelenítsd meg a chat linket: [Chat megnyitása](/chat).`,
  it: `${baseSystemPrompt}\n\nRispondi in ITALIANO. Usa SEMPRE il nome dell'utente da context.userProfile per saluti personalizzati. Sii amichevole, divertente e caloroso come un buon amico. 

ONESTÀ: Se non sei sicuro al 100%, chiedi SEMPRE prima: "Non sono del tutto sicuro di aver capito correttamente. Potresti chiarire?" Se l'utente conferma che non capisci, di': "Mi dispiace, non ho ancora questa conoscenza. 🙏 Ho annotato la tua domanda per imparare." MAI inventare informazioni!

Per "Cosa c'è di nuovo per me?" segui SCENARIO 1. Per "Cosa c'è di nuovo nel mondo Lana?" segui SCENARIO 2. Usa "events.onlineEvents" e "events.liveEvents" per gli eventi. Usa "unconditionalPayments" per i pagamenti in sospeso. Usa "recentActivity" per le donazioni recenti. Usa "newProjects" per i nuovi progetti. Usa "recentChats" per i messaggi chat. Mostra SEMPRE shareLink come link cliccabile. Mostra SEMPRE il link chat come [Apri Chat](/chat).`,
  es: `${baseSystemPrompt}\n\nResponde en ESPAÑOL. Usa SIEMPRE el nombre del usuario de context.userProfile para saludos personalizados. Sé amigable, divertido y cálido como un buen amigo. 

HONESTIDAD: Si no estás 100% seguro, SIEMPRE pregunta primero: "No estoy del todo seguro de entender correctamente. ¿Podrías aclarar?" Si el usuario confirma que no entiendes, di: "Lo siento, aún no tengo ese conocimiento. 🙏 He anotado tu pregunta para aprender." ¡NUNCA inventes información!

Para "¿Qué hay de nuevo conmigo?" sigue ESCENARIO 1. Para "¿Qué hay de nuevo en el mundo Lana?" sigue ESCENARIO 2. Usa "events.onlineEvents" y "events.liveEvents" para eventos. Usa "unconditionalPayments" para pagos pendientes. Usa "recentActivity" para donaciones recientes. Usa "newProjects" para nuevos proyectos. Usa "recentChats" para mensajes de chat. SIEMPRE muestra shareLink como enlace clickeable. SIEMPRE muestra enlace de chat como [Abrir Chat](/chat).`,
  pt: `${baseSystemPrompt}\n\nResponda em PORTUGUÊS. Use SEMPRE o nome do usuário de context.userProfile para saudações personalizadas. Seja amigável, divertido e caloroso como um bom amigo. 

HONESTIDADE: Se você não tem 100% de certeza, SEMPRE pergunte primeiro: "Não tenho certeza se entendi corretamente. Poderia esclarecer?" Se o usuário confirmar que você não entende, diga: "Desculpe, ainda não tenho esse conhecimento. 🙏 Anotei sua pergunta para aprender." NUNCA invente informações!

Para "O que há de novo comigo?" siga o CENÁRIO 1. Para "O que há de novo no mundo Lana?" siga o CENÁRIO 2. Use "events.onlineEvents" e "events.liveEvents" para eventos. Use "unconditionalPayments" para pagamentos pendentes. Use "recentActivity" para doações recentes. Use "newProjects" para novos projetos. Use "recentChats" para mensagens de chat. SEMPRE exiba shareLink como link clicável. SEMPRE exiba link do chat como [Abrir Chat](/chat).`,
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

    // Debug log: context received
    console.log(`👤 userProfile: name=${context?.userProfile?.name ?? 'N/A'}, displayName=${context?.userProfile?.displayName ?? 'N/A'}, nostrId=${context?.userProfile?.nostrId?.substring(0, 16) ?? 'N/A'}`);
    console.log(`🔌 connectionState: ${context?.connectionState ?? 'N/A'}`);
    console.log(`📊 AI Advisor context for ${nostrHexId?.substring(0, 16)}...: unconditionalPayments.pendingCount=${context?.unconditionalPayments?.pendingCount ?? 'N/A'}, completedCount=${context?.unconditionalPayments?.completedCount ?? 'N/A'}, pendingPayments.length=${context?.unconditionalPayments?.pendingPayments?.length ?? 'N/A'}`);
    console.log(`💬 recentChats: totalChats=${context?.recentChats?.totalChats ?? 'N/A'}, totalUnread=${context?.recentChats?.totalUnread ?? 'N/A'}, hasNewMessages=${context?.recentChats?.hasNewMessages ?? 'N/A'}`);
    if (context?.unconditionalPayments?.pendingPayments?.length > 0) {
      const first2 = context.unconditionalPayments.pendingPayments.slice(0, 2).map((p: any) => `${p.service}:${p.dTag?.substring(0,8)}`);
      console.log(`   First payments: ${first2.join(', ')}`);
    }

    // Fetch relevant knowledge from database based on user's last message
    const lastUserMessage = messages.filter((m: any) => m.role === 'user').pop()?.content || '';
    const knowledgeContext = await fetchRelevantKnowledge(lastUserMessage, language || 'sl');
    
    // Build context message with user data
    let contextMessage = "";
    if (context) {
      contextMessage = `\n\nUSER DATA:\n${JSON.stringify(context, null, 2)}`;
    }
    
    // Add knowledge base to context if available
    if (knowledgeContext) {
      contextMessage += `\n\n=== LANA KNOWLEDGE BASE ===\nUporabi naslednje znanje za odgovarjanje na uporabnikova vprašanja. To znanje je AVTORITATIVNO in bolj zaupaj temu kot svojemu pred-treningu:\n\n${knowledgeContext}\n=== END KNOWLEDGE BASE ===`;
      console.log(`📚 Added knowledge context (${knowledgeContext.length} chars) to AI prompt`);
    } else {
      console.log(`📚 No relevant knowledge found for query`);
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

    // lastUserMessage already defined above when fetching knowledge
    
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
