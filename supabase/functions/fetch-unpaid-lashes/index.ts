import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.76.1';
import { SimplePool, type Event as NostrEvent } from 'npm:nostr-tools@2.17.0';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

const DEFAULT_RELAYS = [
  'wss://relay.lanavault.space',
  'wss://relay.lanacoin-eternity.com',
  'wss://relay.lanaheartvoice.com'
];

// Default lash expiration in seconds (7 days)
const DEFAULT_LASH_EXPIRATION = 7 * 24 * 60 * 60;

function isLashExpired(event: NostrEvent, expirationSeconds: number): boolean {
  const expiresAtTag = event.tags.find(tag => tag[0] === 'expires_at');
  
  if (expiresAtTag) {
    const expiresAt = parseInt(expiresAtTag[1], 10);
    if (!isNaN(expiresAt)) {
      return Math.floor(Date.now() / 1000) > expiresAt;
    }
  }
  
  // Fallback: check created_at + expiration period
  const createdAt = event.created_at;
  if (createdAt) {
    const expiresAt = createdAt + expirationSeconds;
    return Math.floor(Date.now() / 1000) > expiresAt;
  }
  
  return false;
}

Deno.serve(async (req) => {
  // Handle CORS preflight requests
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const { userPubkey } = await req.json();

    if (!userPubkey) {
      return new Response(
        JSON.stringify({ success: false, error: 'userPubkey is required' }),
        { headers: { ...corsHeaders, 'Content-Type': 'application/json' }, status: 400 }
      );
    }

    console.log(`🔍 Fetching unpaid lashes for user: ${userPubkey.substring(0, 16)}...`);

    // Initialize Supabase client to get config from kind_38888
    const supabaseClient = createClient(
      Deno.env.get('SUPABASE_URL') ?? '',
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '',
      { auth: { persistSession: false } }
    );

    // Get relays from kind_38888
    const { data: configData } = await supabaseClient
      .from('kind_38888')
      .select('relays')
      .order('created_at', { ascending: false })
      .limit(1)
      .single();

    const relays = (configData?.relays as string[]) || DEFAULT_RELAYS;

    console.log(`📡 Using ${relays.length} relays`);

    // Fetch payment records from Nostr relays
    const pool = new SimplePool();

    const paymentRecords = await Promise.race([
      pool.querySync(relays, {
        kinds: [39991],
        authors: [userPubkey],
        limit: 1000
      }),
      new Promise<NostrEvent[]>((_, reject) => 
        setTimeout(() => reject(new Error('Lash fetch timeout')), 10000)
      )
    ]) as NostrEvent[];

    console.log(`📦 Received ${paymentRecords.length} KIND 39991 events`);

    // Filter out expired and paid records
    const unpaidRecords = paymentRecords.filter(event => {
      if (isLashExpired(event, DEFAULT_LASH_EXPIRATION)) return false;
      const stateTag = event.tags.find(tag => tag[0] === 'state');
      return stateTag?.[1] !== 'paid';
    });

    console.log(`💰 Found ${unpaidRecords.length} unpaid (non-expired, state != paid)`);

    // Extract UNIQUE lash IDs using Set for deduplication
    const lashIdsSet = new Set(
      unpaidRecords
        .map(event => event.tags.find(tag => tag[0] === 'd')?.[1])
        .filter(Boolean)
    );
    const unpaidCount = lashIdsSet.size;
    const unpaidIds = Array.from(lashIdsSet) as string[];

    console.log(`✅ Unique unpaid LASHes: ${unpaidCount}`);

    pool.close(relays);

    return new Response(
      JSON.stringify({
        success: true,
        unpaidCount,
        unpaidIds,
        meta: {
          totalRecords: paymentRecords.length,
          unpaidRecords: unpaidRecords.length
        }
      }),
      {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        status: 200,
      }
    );

  } catch (error) {
    console.error('❌ Error fetching unpaid lashes:', error);
    
    const errorMessage = error instanceof Error ? error.message : 'Unknown error';
    
    return new Response(
      JSON.stringify({
        success: false,
        error: errorMessage,
        unpaidCount: 0,
        unpaidIds: []
      }),
      {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        status: 500,
      }
    );
  }
});
