import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.76.1';
import { SimplePool } from 'npm:nostr-tools@2.17.0';
import { finalizeEvent, getPublicKey } from 'npm:nostr-tools@2.17.0/pure';
import bs58 from 'https://esm.sh/bs58@6.0.0';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

const DEFAULT_RELAYS = [
  'wss://relay.lanavault.space',
  'wss://relay.lanacoin-eternity.com',
  'wss://relay.lanaheartvoice.com'
];

// WIF to hex private key conversion
function wifToHex(wif: string): string {
  const decoded = bs58.decode(wif);
  // Remove version byte (first byte) and checksum (last 4 bytes)
  // For compressed keys, also remove the compression flag (last byte before checksum)
  let privateKeyBytes: Uint8Array;
  
  if (decoded.length === 38) {
    // Compressed WIF (1 version + 32 key + 1 compression flag + 4 checksum)
    privateKeyBytes = decoded.slice(1, 33);
  } else if (decoded.length === 37) {
    // Uncompressed WIF (1 version + 32 key + 4 checksum)
    privateKeyBytes = decoded.slice(1, 33);
  } else {
    throw new Error('Invalid WIF length');
  }
  
  return Array.from(privateKeyBytes).map(b => b.toString(16).padStart(2, '0')).join('');
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const { knowledgeId } = await req.json();

    if (!knowledgeId) {
      throw new Error('Knowledge ID is required');
    }

    console.log('Publishing knowledge:', knowledgeId);

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

    // Get the knowledge entry
    const { data: knowledge, error: knowledgeError } = await supabaseClient
      .from('ai_knowledge')
      .select('*')
      .eq('id', knowledgeId)
      .single();

    if (knowledgeError || !knowledge) {
      throw new Error('Knowledge entry not found');
    }

    console.log('Knowledge entry found:', knowledge.slug);

    // Get the WIF private key from app_settings
    const { data: wifSetting, error: wifError } = await supabaseClient
      .from('app_settings')
      .select('value')
      .eq('key', 'lana_knowledge_wif')
      .single();

    if (wifError || !wifSetting) {
      throw new Error('WIF private key not configured');
    }

    const wif = typeof wifSetting.value === 'string' ? wifSetting.value : JSON.parse(wifSetting.value);
    console.log('WIF key loaded');

    // Convert WIF to hex private key
    const privateKeyHex = wifToHex(wif);
    const secretKey = new Uint8Array(privateKeyHex.match(/.{1,2}/g)!.map(byte => parseInt(byte, 16)));
    const pubkey = getPublicKey(secretKey);

    console.log('Public key:', pubkey);

    // Build the content JSON
    const contentJson = {
      title: knowledge.title,
      summary: knowledge.summary,
      body: knowledge.body || '',
      slug: knowledge.slug,
      revision: knowledge.revision,
      status: knowledge.status,
      lang: knowledge.lang,
      updated_at: Math.floor(new Date(knowledge.updated_at).getTime() / 1000)
    };

    // Build tags
    const tags: string[][] = [
      ['slug', knowledge.slug],
      ['rev', String(knowledge.revision)],
      ['status', knowledge.status],
      ['lang', knowledge.lang],
    ];

    if (knowledge.topic) {
      tags.push(['topic', knowledge.topic]);
    }

    if (knowledge.keywords && knowledge.keywords.length > 0) {
      for (const keyword of knowledge.keywords) {
        tags.push(['keywords', keyword]);
      }
    }

    tags.push(['ref', 'kind:38888:main']);

    // Create the event template
    const eventTemplate = {
      kind: 99991,
      content: JSON.stringify(contentJson),
      tags,
      created_at: Math.floor(Date.now() / 1000),
    };

    console.log('Event template created');

    // Sign the event
    const signedEvent = finalizeEvent(eventTemplate, secretKey);

    console.log('Event signed:', signedEvent.id);

    // Publish to relays
    const pool = new SimplePool();

    try {
      const publishPromises = DEFAULT_RELAYS.map(async (relay) => {
        try {
          await pool.publish([relay], signedEvent);
          console.log(`Published to ${relay}`);
          return { relay, success: true };
        } catch (err) {
          console.error(`Failed to publish to ${relay}:`, err);
          return { relay, success: false, error: err instanceof Error ? err.message : 'Unknown error' };
        }
      });

      await Promise.allSettled(publishPromises);
      
      // Wait a bit for events to propagate
      await new Promise(resolve => setTimeout(resolve, 2000));
    } finally {
      pool.close(DEFAULT_RELAYS);
    }

    // Update the knowledge entry with the event ID
    await supabaseClient
      .from('ai_knowledge')
      .update({ nostr_event_id: signedEvent.id })
      .eq('id', knowledgeId);

    console.log('Knowledge entry updated with event ID');

    return new Response(
      JSON.stringify({
        success: true,
        eventId: signedEvent.id,
        pubkey,
        message: 'Knowledge published successfully'
      }),
      {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        status: 200,
      }
    );

  } catch (error) {
    console.error('Error publishing knowledge:', error);
    
    return new Response(
      JSON.stringify({
        success: false,
        error: error instanceof Error ? error.message : 'Unknown error'
      }),
      {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        status: 500,
      }
    );
  }
});
