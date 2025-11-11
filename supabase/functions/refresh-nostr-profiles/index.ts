import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.7.1";
import { SimplePool } from "npm:nostr-tools@2.17.0";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

const DEFAULT_RELAYS = [
  'wss://relay.lanavault.space',
  'wss://relay.lanacoin-eternity.com',
  'wss://relay.lanaheartvoice.com'
];

interface NostrEvent {
  id: string;
  pubkey: string;
  created_at: number;
  kind: number;
  tags: string[][];
  content: string;
  sig: string;
}

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
    const supabaseServiceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
    const supabase = createClient(supabaseUrl, supabaseServiceKey);

    const url = new URL(req.url);
    const mode = url.searchParams.get('mode') || 'stale';

    const BATCH_SIZE = 100; // Max 100 profiles per request
    let pubkeysToRefresh: string[] = [];

    // Determine which profiles to refresh
    if (req.method === 'POST') {
      const body = await req.json();
      const requestedPubkeys = body.pubkeys || [];
      pubkeysToRefresh = requestedPubkeys.slice(0, BATCH_SIZE);
      console.log(`📬 Manual refresh requested for ${requestedPubkeys.length} pubkeys, processing first ${pubkeysToRefresh.length}`);
    } else if (mode === 'stale') {
      // Refresh profiles older than 24 hours, oldest first, limited to batch
      const { data, error } = await supabase
        .from('nostr_profiles')
        .select('nostr_hex_id')
        .lt('last_fetched_at', new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString())
        .order('last_fetched_at', { ascending: true })
        .limit(BATCH_SIZE);
      
      if (error) {
        console.error('❌ Error fetching stale profiles:', error);
        throw error;
      }
      
      pubkeysToRefresh = data?.map(p => p.nostr_hex_id) || [];
      console.log(`⏰ Found ${pubkeysToRefresh.length} stale profiles to refresh (batch: ${BATCH_SIZE})`);
    } else if (mode === 'all') {
      const { data, error } = await supabase
        .from('nostr_profiles')
        .select('nostr_hex_id')
        .order('last_fetched_at', { ascending: true })
        .limit(BATCH_SIZE);
      
      if (error) {
        console.error('❌ Error fetching all profiles:', error);
        throw error;
      }
      
      pubkeysToRefresh = data?.map(p => p.nostr_hex_id) || [];
      console.log(`🔄 Refreshing ${pubkeysToRefresh.length} oldest profiles (batch: ${BATCH_SIZE})`);
    }

    if (pubkeysToRefresh.length === 0) {
      console.log('✅ No profiles to refresh');
      return new Response(
        JSON.stringify({ success: true, refreshed: 0, message: 'No profiles to refresh' }),
        { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // Fetch system parameters for relays
    const { data: settings } = await supabase
      .from('app_settings')
      .select('value')
      .eq('key', 'system_parameters')
      .single();

    const relays = settings?.value?.relays || DEFAULT_RELAYS;
    console.log(`📡 Using relays: ${relays.join(', ')}`);
    console.log(`🎯 Searching for ${pubkeysToRefresh.length} pubkeys:`, pubkeysToRefresh.slice(0, 5).map(pk => pk.substring(0, 16) + '...'));

    // Fetch profiles from Nostr
    const pool = new SimplePool();
    const profiles: any[] = [];
    let fetchErrors = 0;

    try {
      console.log(`🔍 Fetching ${pubkeysToRefresh.length} profiles from Nostr...`);
      const startTime = Date.now();
      
      const events = await Promise.race([
        pool.querySync(relays, {
          kinds: [0],
          authors: pubkeysToRefresh,
        }),
        new Promise<NostrEvent[]>((_, reject) => 
          setTimeout(() => reject(new Error('Profile fetch timeout')), 30000)
        )
      ]);

      const fetchTime = Date.now() - startTime;
      console.log(`📥 Fetched ${events.length} KIND 0 events from Nostr in ${fetchTime}ms`);
      console.log(`🔍 Found profiles for pubkeys:`, events.map(e => e.pubkey.substring(0, 16) + '...'));

      // Deduplicate events - keep only the newest event for each pubkey
      const latestEvents = new Map<string, NostrEvent>();
      events.forEach((event: NostrEvent) => {
        const existing = latestEvents.get(event.pubkey);
        if (!existing || event.created_at > existing.created_at) {
          latestEvents.set(event.pubkey, event);
        }
      });

      console.log(`🔄 Deduplicated to ${latestEvents.size} unique profiles`);

      latestEvents.forEach((event: NostrEvent) => {
        try {
          const content = JSON.parse(event.content);
          
          // Log what we found for debugging
          console.log(`✅ Parsed profile for ${event.pubkey.substring(0, 16)}...: name=${content.name}, picture=${content.picture ? 'YES' : 'NO'}`);
          
          profiles.push({
            nostr_hex_id: event.pubkey,
            full_name: content.name,
            display_name: content.display_name,
            picture: content.picture,
            about: content.about,
            lana_wallet_id: content.lanaWalletID,
            raw_metadata: content,
            last_fetched_at: new Date().toISOString(),
            updated_at: new Date().toISOString(),
          });
        } catch (error) {
          fetchErrors++;
          console.error(`❌ Error parsing profile for ${event.pubkey}:`, error);
        }
      });
    } catch (error) {
      console.error('❌ Error fetching profiles from Nostr:', error);
    } finally {
      pool.close(relays);
    }

    // Upsert profiles to database
    let upsertedCount = 0;
    if (profiles.length > 0) {
      const { error } = await supabase
        .from('nostr_profiles')
        .upsert(profiles, { onConflict: 'nostr_hex_id' });

      if (error) {
        console.error('❌ Error upserting profiles:', error);
        throw error;
      }

      upsertedCount = profiles.length;
      console.log(`💾 Upserted ${upsertedCount} profiles to database`);
    }

    const notFound = pubkeysToRefresh.length - profiles.length - fetchErrors;
    console.log(`📊 Stats: ${upsertedCount} updated, ${fetchErrors} parse errors, ${notFound} not found`);

    return new Response(
      JSON.stringify({ 
        success: true, 
        refreshed: upsertedCount,
        total_requested: pubkeysToRefresh.length,
        parseErrors: fetchErrors,
        notFound,
        mode,
        batchSize: BATCH_SIZE
      }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );

  } catch (error) {
    console.error('❌ Error in refresh-nostr-profiles:', error);
    return new Response(
      JSON.stringify({ error: error instanceof Error ? error.message : 'Unknown error' }),
      { 
        status: 500,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' }
      }
    );
  }
});
