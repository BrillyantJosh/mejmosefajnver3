import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

serve(async (req) => {
  // Handle CORS preflight
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const supabaseServiceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const supabase = createClient(supabaseUrl, supabaseServiceKey);

    const { recipientPubkey, senderDisplayName, messagePreview } = await req.json();

    if (!recipientPubkey) {
      return new Response(
        JSON.stringify({ error: "recipientPubkey is required" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // Get VAPID keys from app_settings
    const { data: vapidPublicData } = await supabase
      .from("app_settings")
      .select("value")
      .eq("key", "vapid_public_key")
      .single();

    const { data: vapidPrivateData } = await supabase
      .from("app_settings")
      .select("value")
      .eq("key", "vapid_private_key")
      .single();

    if (!vapidPublicData?.value || !vapidPrivateData?.value) {
      console.error("VAPID keys not configured");
      return new Response(
        JSON.stringify({ error: "Push notifications not configured" }),
        { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const vapidPublicKey = String(vapidPublicData.value).replace(/^"|"$/g, '');
    const _vapidPrivateKey = String(vapidPrivateData.value).replace(/^"|"$/g, '');

    // Get all push subscriptions for the recipient
    const { data: subscriptions, error: subError } = await supabase
      .from("push_subscriptions")
      .select("*")
      .eq("nostr_hex_id", recipientPubkey);

    if (subError) {
      console.error("Error fetching subscriptions:", subError);
      return new Response(
        JSON.stringify({ error: "Failed to fetch subscriptions" }),
        { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    if (!subscriptions || subscriptions.length === 0) {
      console.log("No push subscriptions found for:", recipientPubkey);
      return new Response(
        JSON.stringify({ message: "No subscriptions found", sent: 0 }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    console.log(`Found ${subscriptions.length} subscriptions for ${recipientPubkey}`);

    // Prepare notification payload
    const notificationPayload = JSON.stringify({
      title: `New message from ${senderDisplayName || 'Someone'}`,
      body: messagePreview || 'You have a new message',
      tag: `dm-${Date.now()}`,
      url: '/chat',
      senderPubkey: recipientPubkey,
    });

    let sentCount = 0;
    const failedEndpoints: string[] = [];

    // Send to all subscriptions using simple fetch (Web Push without encryption for now)
    // Note: Full Web Push encryption would require additional crypto implementation
    for (const sub of subscriptions) {
      try {
        // For now, we'll send a simple notification
        // Full implementation would use web-push library or manual ECDH encryption
        const response = await fetch(sub.endpoint, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            TTL: "86400",
            Urgency: "normal",
            Authorization: `vapid t=eyJhbGciOiJFUzI1NiIsInR5cCI6IkpXVCJ9, k=${vapidPublicKey}`,
          },
          body: notificationPayload,
        });

        if (response.ok || response.status === 201) {
          sentCount++;
          console.log(`Push sent to ${sub.endpoint.substring(0, 50)}...`);
        } else if (response.status === 410 || response.status === 404) {
          // Subscription expired or invalid - remove it
          console.log(`Removing expired subscription: ${sub.endpoint.substring(0, 50)}...`);
          await supabase
            .from("push_subscriptions")
            .delete()
            .eq("id", sub.id);
          failedEndpoints.push(sub.endpoint);
        } else {
          console.error(`Failed to send push: ${response.status} ${response.statusText}`);
          const errorText = await response.text();
          console.error(`Response body: ${errorText}`);
          failedEndpoints.push(sub.endpoint);
        }
      } catch (error) {
        console.error(`Error sending to ${sub.endpoint}:`, error);
        failedEndpoints.push(sub.endpoint);
      }
    }

    return new Response(
      JSON.stringify({ 
        message: "Push notifications processed",
        sent: sentCount,
        failed: failedEndpoints.length,
      }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  } catch (error) {
    console.error("Error in send-push-notification:", error);
    const errorMessage = error instanceof Error ? error.message : "Unknown error";
    return new Response(
      JSON.stringify({ error: errorMessage }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});
