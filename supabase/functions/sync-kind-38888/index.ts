import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.76.1';
import { SimplePool, type Event as NostrEvent } from 'npm:nostr-tools@2.17.0';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

const AUTHORIZED_PUBKEY = '9eb71bf1e9c3189c78800e4c3831c1c1a93ab43b61118818c32e4490891a35b3';

const DEFAULT_RELAYS = [
  'wss://relay.lanavault.space',
  'wss://relay.lanacoin-eternity.com',
  'wss://relay.lanaheartvoice.com'
];

Deno.serve(async (req) => {
  // Handle CORS preflight requests
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    console.log('Starting KIND 38888 sync...');

    // Initialize Supabase client
    const supabaseClient = createClient(
      Deno.env.get('SUPABASE_URL') ?? '',
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '',
      {
        auth: {
          persistSession: false,
        },
      }
    );

    // Fetch KIND 38888 from Nostr relays
    const pool = new SimplePool();

    const filter = {
      kinds: [38888],
      authors: [AUTHORIZED_PUBKEY],
      '#d': ['main'],
      limit: 1
    };

    console.log('Fetching KIND 38888 from relays...');

    const event = await Promise.race([
      pool.get(DEFAULT_RELAYS, filter),
      new Promise<NostrEvent | null>((_, reject) => 
        setTimeout(() => reject(new Error('Timeout')), 10000)
      )
    ]) as NostrEvent | null;

    if (!event) {
      throw new Error('No KIND 38888 event found');
    }

    console.log('KIND 38888 event received:', event.id);

    // Verify authorized pubkey
    if (event.pubkey !== AUTHORIZED_PUBKEY) {
      throw new Error('Unauthorized pubkey');
    }

    // Parse tags
    const relays = event.tags
      .filter((t: string[]) => t[0] === 'relay')
      .map((t: string[]) => t[1]);

    const electrumServers = event.tags
      .filter((t: string[]) => t[0] === 'electrum')
      .map((t: string[]) => ({ host: t[1], port: t[2] }));

    const fxTags = event.tags.filter((t: string[]) => t[0] === 'fx');
    const exchangeRates = {
      EUR: parseFloat(fxTags.find((t: string[]) => t[1] === 'EUR')?.[2] || '0'),
      USD: parseFloat(fxTags.find((t: string[]) => t[1] === 'USD')?.[2] || '0'),
      GBP: parseFloat(fxTags.find((t: string[]) => t[1] === 'GBP')?.[2] || '0')
    };

    const split = event.tags.find((t: string[]) => t[0] === 'split')?.[1] || '';
    const version = event.tags.find((t: string[]) => t[0] === 'version')?.[1] || '';
    const validFrom = event.tags.find((t: string[]) => t[0] === 'valid_from')?.[1] || '';

    // Parse trusted_signers from content
    let trustedSigners = {};
    try {
      if (event.content) {
        const contentData = JSON.parse(event.content);
        trustedSigners = contentData.trusted_signers || {};
      }
    } catch (error) {
      console.warn('Failed to parse event content for trusted_signers:', error);
    }

    // Upsert into database
    const { data, error } = await supabaseClient
      .from('kind_38888')
      .upsert({
        event_id: event.id,
        pubkey: event.pubkey,
        created_at: event.created_at,
        relays: relays,
        electrum_servers: electrumServers,
        exchange_rates: exchangeRates,
        split: split,
        version: version,
        valid_from: validFrom ? parseInt(validFrom) : null,
        trusted_signers: trustedSigners,
        raw_event: event
      }, {
        onConflict: 'event_id'
      })
      .select()
      .single();

    if (error) {
      console.error('Database error:', error);
      throw error;
    }

    console.log('KIND 38888 synced successfully:', data.id);

    pool.close(DEFAULT_RELAYS);

    return new Response(
      JSON.stringify({
        success: true,
        message: 'KIND 38888 synced successfully',
        data: {
          event_id: data.event_id,
          version: data.version,
          split: data.split,
          relays_count: relays.length,
          electrum_count: electrumServers.length
        }
      }),
      {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        status: 200,
      }
    );

  } catch (error) {
    console.error('Error syncing KIND 38888:', error);
    
    const errorMessage = error instanceof Error ? error.message : 'Unknown error';
    
    return new Response(
      JSON.stringify({
        success: false,
        error: errorMessage
      }),
      {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        status: 500,
      }
    );
  }
});