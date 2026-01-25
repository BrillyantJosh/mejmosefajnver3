import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { SimplePool } from "https://esm.sh/nostr-tools@2.7.2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const DEFAULT_LANA_RELAYS = [
  "wss://relay.lana.bz",
  "wss://relay2.lana.bz"
];

interface RelayConfig {
  url: string;
  read: boolean;
  write: boolean;
}

interface NostrEvent {
  id: string;
  pubkey: string;
  created_at: number;
  kind: number;
  tags: string[][];
  content: string;
  sig: string;
}

Deno.serve(async (req) => {
  // Handle CORS preflight
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  const startTime = Date.now();
  const MAX_EXECUTION_TIME = 50000; // 50 seconds max (edge function limit is 60s)

  try {
    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const supabaseServiceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const supabase = createClient(supabaseUrl, supabaseServiceKey);

    console.log("🔄 Starting DM poll for push notifications...");

    // Step 1: Get all unique nostr_hex_ids with push subscriptions
    const { data: subscriptions, error: subError } = await supabase
      .from("push_subscriptions")
      .select("nostr_hex_id");

    if (subError) {
      console.error("❌ Error fetching subscriptions:", subError);
      throw subError;
    }

    if (!subscriptions || subscriptions.length === 0) {
      console.log("ℹ️ No push subscriptions found, nothing to poll");
      return new Response(JSON.stringify({ success: true, message: "No subscriptions" }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Get unique nostr_hex_ids
    const uniqueHexIds = [...new Set(subscriptions.map((s) => s.nostr_hex_id))];
    console.log(`📋 Found ${uniqueHexIds.length} unique users with push subscriptions`);

    // Step 2: Get relays from KIND 38888 or use fallback
    let relays: string[] = DEFAULT_LANA_RELAYS;
    
    const { data: kind38888, error: kindError } = await supabase
      .from("kind_38888")
      .select("relays")
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();

    if (!kindError && kind38888?.relays) {
      try {
        const relayConfigs = kind38888.relays as RelayConfig[];
        const readRelays = relayConfigs
          .filter((r) => r.read)
          .map((r) => r.url);
        
        if (readRelays.length > 0) {
          relays = readRelays;
          console.log(`📡 Using ${relays.length} relays from KIND 38888`);
        }
      } catch (e) {
        console.log("⚠️ Could not parse relays from KIND 38888, using fallback");
      }
    }

    // Step 3: Get last seen timestamps for all users
    const { data: lastSeenData, error: lastSeenError } = await supabase
      .from("dm_last_seen")
      .select("nostr_hex_id, last_event_created_at")
      .in("nostr_hex_id", uniqueHexIds);

    if (lastSeenError) {
      console.error("❌ Error fetching last seen data:", lastSeenError);
    }

    const lastSeenMap = new Map<string, number>();
    if (lastSeenData) {
      for (const row of lastSeenData) {
        lastSeenMap.set(row.nostr_hex_id, row.last_event_created_at);
      }
    }

    // Step 4: Query relays for new DMs
    const pool = new SimplePool();
    let totalNotificationsSent = 0;
    let totalErrors = 0;

    try {
      for (const recipientHexId of uniqueHexIds) {
        // Check execution time
        if (Date.now() - startTime > MAX_EXECUTION_TIME) {
          console.log("⏱️ Approaching time limit, stopping early");
          break;
        }

        const lastSeen = lastSeenMap.get(recipientHexId) || 0;
        console.log(`🔍 Checking DMs for ${recipientHexId.slice(0, 8)}... (last seen: ${lastSeen})`);

        try {
          // Query for KIND 4 events addressed to this user
          const events = await pool.querySync(relays, {
            kinds: [4],
            "#p": [recipientHexId],
            since: lastSeen + 1,
            limit: 20,
          });

          if (events.length === 0) {
            console.log(`  ℹ️ No new DMs for ${recipientHexId.slice(0, 8)}`);
            continue;
          }

          console.log(`  📬 Found ${events.length} new DM(s) for ${recipientHexId.slice(0, 8)}`);

          // Find max created_at for updating last seen
          const maxCreatedAt = Math.max(...(events as NostrEvent[]).map((e) => e.created_at));

          // Get unique senders
          const senderPubkeys: string[] = [...new Set((events as NostrEvent[]).map((e) => e.pubkey))];

          // For each sender, get their profile and send notification
          for (const senderPubkey of senderPubkeys) {
            // Skip if sender is same as recipient (self-messages)
            if (senderPubkey === recipientHexId) {
              continue;
            }

            // Get sender profile from DB
            const { data: senderProfile } = await supabase
              .from("nostr_profiles")
              .select("display_name, full_name")
              .eq("nostr_hex_id", senderPubkey)
              .maybeSingle();

            const senderDisplayName = 
              senderProfile?.display_name || 
              senderProfile?.full_name || 
              senderPubkey.slice(0, 8);

            // Send push notification
            console.log(`  📱 Sending push to ${recipientHexId.slice(0, 8)} from ${senderDisplayName}`);
            
            const { error: pushError } = await supabase.functions.invoke(
              "send-push-notification",
              {
                body: {
                  recipientPubkey: recipientHexId,
                  senderDisplayName: senderDisplayName,
                  messagePreview: "", // Empty - no preview as per user request
                },
              }
            );

            if (pushError) {
              console.error(`  ❌ Push error for ${recipientHexId.slice(0, 8)}:`, pushError);
              totalErrors++;
            } else {
              totalNotificationsSent++;
            }
          }

          // Update last seen timestamp
          const { error: upsertError } = await supabase
            .from("dm_last_seen")
            .upsert({
              nostr_hex_id: recipientHexId,
              last_event_created_at: maxCreatedAt,
              updated_at: new Date().toISOString(),
            });

          if (upsertError) {
            console.error(`  ⚠️ Error updating last seen for ${recipientHexId.slice(0, 8)}:`, upsertError);
          }

        } catch (userError) {
          console.error(`  ❌ Error processing user ${recipientHexId.slice(0, 8)}:`, userError);
          totalErrors++;
        }
      }
    } finally {
      pool.close(relays);
    }

    const executionTime = Date.now() - startTime;
    console.log(`✅ Poll complete in ${executionTime}ms. Sent: ${totalNotificationsSent}, Errors: ${totalErrors}`);

    return new Response(
      JSON.stringify({
        success: true,
        usersChecked: uniqueHexIds.length,
        notificationsSent: totalNotificationsSent,
        errors: totalErrors,
        executionTimeMs: executionTime,
      }),
      {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      }
    );

  } catch (error: unknown) {
    const errorMessage = error instanceof Error ? error.message : "Unknown error";
    console.error("❌ Poll failed:", error);
    return new Response(
      JSON.stringify({ success: false, error: errorMessage }),
      {
        status: 500,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      }
    );
  }
});
