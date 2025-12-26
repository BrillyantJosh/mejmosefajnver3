import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.76.1';
import { serve } from 'https://deno.land/std@0.168.0/http/server.ts';
import { schnorr } from 'https://esm.sh/@noble/curves@1.4.0/secp256k1';
import { sha256 } from 'https://esm.sh/@noble/hashes@1.4.0/sha256';
import { bytesToHex, hexToBytes } from 'https://esm.sh/@noble/hashes@1.4.0/utils';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

// Verify a Nostr event signature
function verifyNostrEvent(event: {
  id: string;
  pubkey: string;
  created_at: number;
  kind: number;
  tags: string[][];
  content: string;
  sig: string;
}): boolean {
  try {
    // Reconstruct the event ID to verify it wasn't tampered
    const serialized = JSON.stringify([
      0,
      event.pubkey,
      event.created_at,
      event.kind,
      event.tags,
      event.content,
    ]);
    const eventIdBytes = sha256(new TextEncoder().encode(serialized));
    const computedId = bytesToHex(eventIdBytes);
    
    if (computedId !== event.id) {
      console.error('❌ [update-app-settings] Event ID mismatch');
      return false;
    }
    
    // Verify the signature
    const isValid = schnorr.verify(
      event.sig,
      event.id,
      event.pubkey
    );
    
    return isValid;
  } catch (error) {
    console.error('❌ [update-app-settings] Signature verification error:', error);
    return false;
  }
}

serve(async (req) => {
  // Handle CORS preflight requests
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const { signedEvent, key, value } = await req.json();

    console.log('🔍 [update-app-settings] Received request for key:', key);

    // Validate required fields
    if (!signedEvent || !key || value === undefined) {
      console.error('❌ [update-app-settings] Missing required fields');
      return new Response(
        JSON.stringify({ error: 'Missing required fields: signedEvent, key, value' }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // Validate signed event structure
    if (!signedEvent.id || !signedEvent.pubkey || !signedEvent.sig || !signedEvent.created_at) {
      console.error('❌ [update-app-settings] Invalid signed event structure');
      return new Response(
        JSON.stringify({ error: 'Invalid signed event: missing required fields (id, pubkey, sig, created_at)' }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // Check that the event is recent (within 5 minutes) to prevent replay attacks
    const eventTime = signedEvent.created_at * 1000; // Convert to milliseconds
    const now = Date.now();
    const fiveMinutes = 5 * 60 * 1000;
    
    if (Math.abs(now - eventTime) > fiveMinutes) {
      console.error('❌ [update-app-settings] Event timestamp too old or in future');
      return new Response(
        JSON.stringify({ error: 'Event timestamp is stale or invalid. Please try again.' }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // Verify the Nostr signature
    console.log('🔍 [update-app-settings] Verifying Nostr signature for pubkey:', signedEvent.pubkey);
    const isValidSignature = verifyNostrEvent(signedEvent);
    
    if (!isValidSignature) {
      console.error('❌ [update-app-settings] Invalid Nostr signature');
      return new Response(
        JSON.stringify({ error: 'Invalid signature. Could not verify identity.' }),
        { status: 401, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    console.log('✅ [update-app-settings] Nostr signature verified');

    // Verify the event content contains the expected operation
    let eventContent;
    try {
      eventContent = JSON.parse(signedEvent.content);
    } catch {
      console.error('❌ [update-app-settings] Invalid event content');
      return new Response(
        JSON.stringify({ error: 'Invalid event content format' }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // Verify the signed content matches the request
    if (eventContent.action !== 'update-app-settings' || eventContent.key !== key) {
      console.error('❌ [update-app-settings] Event content does not match request');
      return new Response(
        JSON.stringify({ error: 'Signed event does not match requested operation' }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    const nostrHexId = signedEvent.pubkey;

    // Create Supabase client with anon key for admin check
    const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
    const supabaseAnonKey = Deno.env.get('SUPABASE_ANON_KEY')!;
    const supabaseClient = createClient(supabaseUrl, supabaseAnonKey);

    // Check if user is admin
    console.log('🔍 [update-app-settings] Checking admin status for:', nostrHexId);
    const { data: adminData, error: adminError } = await supabaseClient
      .from('admin_users')
      .select('nostr_hex_id')
      .eq('nostr_hex_id', nostrHexId)
      .maybeSingle();

    if (adminError) {
      console.error('❌ [update-app-settings] Error checking admin status:', adminError);
      return new Response(
        JSON.stringify({ error: 'Failed to verify admin status' }),
        { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    if (!adminData) {
      console.error('❌ [update-app-settings] User is not an admin');
      return new Response(
        JSON.stringify({ error: 'Unauthorized: User is not an admin' }),
        { status: 403, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    console.log('✅ [update-app-settings] User is admin, proceeding with update');

    // Create Supabase client with service role key for update
    const supabaseServiceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
    const supabaseServiceClient = createClient(supabaseUrl, supabaseServiceKey);

    // Update app settings
    const { error: updateError } = await supabaseServiceClient
      .from('app_settings')
      .update({ value: value })
      .eq('key', key);

    if (updateError) {
      console.error('❌ [update-app-settings] Error updating settings:', updateError);
      return new Response(
        JSON.stringify({ error: 'Failed to update app settings' }),
        { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    console.log('✅ [update-app-settings] Successfully updated app settings');

    return new Response(
      JSON.stringify({ success: true, message: 'App settings updated successfully' }),
      { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  } catch (error) {
    console.error('❌ [update-app-settings] Unexpected error:', error);
    return new Response(
      JSON.stringify({ error: 'Internal server error' }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  }
});
