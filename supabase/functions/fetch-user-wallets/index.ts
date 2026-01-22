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

interface WalletData {
  walletId: string;
  walletType: string;
  note?: string;
  amountUnregistered?: string;
  eventId?: string;
  createdAt?: number;
  registrarPubkey?: string;
  status?: string;
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

    console.log(`🔍 Fetching wallets for user: ${userPubkey.substring(0, 16)}...`);

    // Initialize Supabase client to get trusted signers from kind_38888
    const supabaseClient = createClient(
      Deno.env.get('SUPABASE_URL') ?? '',
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '',
      { auth: { persistSession: false } }
    );

    // Get relays and trusted signers from kind_38888
    const { data: configData } = await supabaseClient
      .from('kind_38888')
      .select('relays, trusted_signers')
      .order('created_at', { ascending: false })
      .limit(1)
      .single();

    const relays = (configData?.relays as string[]) || DEFAULT_RELAYS;
    const trustedSigners = (configData?.trusted_signers as Record<string, string[]>) || {};
    const lanaRegistrarSigners = trustedSigners.LanaRegistrar || [];

    console.log(`📡 Using ${relays.length} relays, ${lanaRegistrarSigners.length} trusted signers`);

    // Fetch wallet records from Nostr relays
    const pool = new SimplePool();

    const events = await Promise.race([
      pool.querySync(relays, {
        kinds: [30889],
        '#d': [userPubkey],
      }),
      new Promise<NostrEvent[]>((_, reject) => 
        setTimeout(() => reject(new Error('Wallet fetch timeout')), 10000)
      )
    ]) as NostrEvent[];

    console.log(`📦 Received ${events.length} KIND 30889 events`);

    // Filter events to only include those from trusted signers
    const filteredEvents = lanaRegistrarSigners.length === 0 
      ? events 
      : events.filter(event => lanaRegistrarSigners.includes(event.pubkey));

    console.log(`✅ Using ${filteredEvents.length} events after trusted signer filter`);

    const allWallets: WalletData[] = [];

    // Process each event
    filteredEvents.forEach(event => {
      const statusTag = event.tags.find(t => t[0] === 'status');
      const status = statusTag?.[1] || 'active';

      // Extract all wallet ("w") tags
      const walletTags = event.tags.filter(t => t[0] === 'w');

      walletTags.forEach(tag => {
        // w tag format: ["w", wallet_id, wallet_type, "LANA", note, amount_unregistered_lanoshi]
        if (tag.length >= 6) {
          allWallets.push({
            walletId: tag[1],
            walletType: tag[2],
            note: tag[4] || '',
            amountUnregistered: tag[5],
            status: status,
            registrarPubkey: event.pubkey,
            eventId: event.id,
            createdAt: event.created_at
          });
        }
      });
    });

    // Sort by creation date, newest first
    allWallets.sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0));

    // Deduplicate wallets by walletId, keeping only the latest
    const uniqueWallets = Array.from(
      new Map(allWallets.map(wallet => [wallet.walletId, wallet])).values()
    );

    console.log(`💰 Returning ${uniqueWallets.length} unique wallets`);

    pool.close(relays);

    return new Response(
      JSON.stringify({
        success: true,
        wallets: uniqueWallets,
        meta: {
          totalEvents: events.length,
          filteredEvents: filteredEvents.length,
          uniqueWallets: uniqueWallets.length
        }
      }),
      {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        status: 200,
      }
    );

  } catch (error) {
    console.error('❌ Error fetching wallets:', error);
    
    const errorMessage = error instanceof Error ? error.message : 'Unknown error';
    
    return new Response(
      JSON.stringify({
        success: false,
        error: errorMessage,
        wallets: []
      }),
      {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        status: 500,
      }
    );
  }
});
