import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.76.1';
import { SimplePool } from 'npm:nostr-tools@2.17.0';
import { finalizeEvent } from 'npm:nostr-tools@2.17.0/pure';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

// Base58 alphabet (Bitcoin/LanaCoin standard)
const BASE58_ALPHABET = '123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz';

// Base58 decode function
function base58Decode(str: string): Uint8Array {
  let num = 0n;
  for (const char of str) {
    const index = BASE58_ALPHABET.indexOf(char);
    if (index === -1) throw new Error('Invalid Base58 character');
    num = num * 58n + BigInt(index);
  }
  
  let hex = num.toString(16);
  if (hex.length % 2) hex = '0' + hex;
  
  const bytes = new Uint8Array(hex.length / 2);
  for (let i = 0; i < hex.length; i += 2) {
    bytes[i / 2] = parseInt(hex.slice(i, i + 2), 16);
  }
  
  // Handle leading '1's (zeros in Base58)
  let leadingZeros = 0;
  for (const char of str) {
    if (char !== '1') break;
    leadingZeros++;
  }
  
  if (leadingZeros > 0) {
    const result = new Uint8Array(leadingZeros + bytes.length);
    result.set(bytes, leadingZeros);
    return result;
  }
  
  return bytes;
}

// Double SHA-256 for checksum verification
async function sha256d(data: Uint8Array): Promise<Uint8Array> {
  // Copy to new ArrayBuffer to satisfy TypeScript
  const buffer = new ArrayBuffer(data.length);
  new Uint8Array(buffer).set(data);
  const firstHash = await crypto.subtle.digest('SHA-256', buffer);
  const secondHash = await crypto.subtle.digest('SHA-256', firstHash);
  return new Uint8Array(secondHash);
}

// LanaCoin WIF to hex private key conversion (version byte 0xb0)
async function wifToHex(wif: string): Promise<string> {
  // Normalize WIF - remove whitespace and invisible characters
  const normalizedWif = wif.replace(/[\s\u200B-\u200D\uFEFF\r\n\t]/g, '').trim();
  
  console.log('Decoding WIF, length:', normalizedWif.length);
  
  // Decode Base58
  const decoded = base58Decode(normalizedWif);
  console.log('Decoded bytes length:', decoded.length);
  
  // Extract payload and checksum
  const payload = decoded.slice(0, -4);
  const checksum = decoded.slice(-4);
  
  // Verify checksum
  const hash = await sha256d(payload);
  const expectedChecksum = hash.slice(0, 4);
  
  for (let i = 0; i < 4; i++) {
    if (checksum[i] !== expectedChecksum[i]) {
      throw new Error('Invalid WIF checksum');
    }
  }
  
  console.log('Checksum verified');
  console.log('Version byte:', payload[0].toString(16));
  
  // Verify version byte (0xb0 = 176 for LanaCoin)
  if (payload[0] !== 0xb0) {
    throw new Error(`Invalid WIF version byte: expected 0xb0 (176), got 0x${payload[0].toString(16)} (${payload[0]})`);
  }
  
  // Extract private key (32 bytes after version byte)
  // For compressed WIF: version(1) + key(32) + compression(1) + checksum(4) = 38 bytes
  // For uncompressed WIF: version(1) + key(32) + checksum(4) = 37 bytes
  const privateKeyBytes = payload.slice(1, 33);
  
  // Convert to hex
  const privateKeyHex = Array.from(privateKeyBytes)
    .map(b => b.toString(16).padStart(2, '0'))
    .join('');
  
  console.log('Private key extracted, length:', privateKeyHex.length);
  
  return privateKeyHex;
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

    // Initialize Supabase client with service role
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

    // Get relays from KIND 38888 table (same as app uses)
    const { data: kindData, error: kindError } = await supabaseClient
      .from('kind_38888')
      .select('relays')
      .order('created_at', { ascending: false })
      .limit(1)
      .single();

    let relays: string[] = [];
    if (kindError || !kindData?.relays) {
      console.warn('Could not fetch relays from kind_38888, using defaults');
      relays = [
        'wss://relay.lanavault.space',
        'wss://relay.lanacoin-eternity.com',
        'wss://relay.lanaheartvoice.com'
      ];
    } else {
      relays = kindData.relays as string[];
    }

    console.log('Using relays:', relays);

    // Get the WIF private key from app_settings
    const { data: wifSetting, error: wifError } = await supabaseClient
      .from('app_settings')
      .select('value')
      .eq('key', 'lana_knowledge_wif')
      .single();

    if (wifError || !wifSetting) {
      throw new Error('WIF private key not configured in app_settings');
    }

    // Handle both string and JSON-wrapped values
    let wif: string;
    if (typeof wifSetting.value === 'string') {
      wif = wifSetting.value;
    } else if (typeof wifSetting.value === 'object' && wifSetting.value !== null) {
      // If it's JSON-wrapped, try to extract the value
      wif = String(wifSetting.value);
    } else {
      throw new Error('Invalid WIF format in app_settings');
    }

    console.log('WIF key loaded, first chars:', wif.substring(0, 4) + '...');

    // Convert WIF to hex private key (LanaCoin format with 0xb0 version byte)
    const privateKeyHex = await wifToHex(wif);
    
    // Convert hex to Uint8Array for nostr-tools
    const secretKey = new Uint8Array(
      privateKeyHex.match(/.{1,2}/g)!.map(byte => parseInt(byte, 16))
    );

    console.log('Secret key derived, length:', secretKey.length);

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

    // Build tags according to Nostr conventions
    const tags: string[][] = [
      ['d', knowledge.slug], // NIP-33 addressable event identifier
      ['slug', knowledge.slug],
      ['rev', String(knowledge.revision)],
      ['status', knowledge.status],
      ['lang', knowledge.lang],
    ];

    if (knowledge.topic) {
      tags.push(['topic', knowledge.topic]);
    }

    if (knowledge.keywords && Array.isArray(knowledge.keywords) && knowledge.keywords.length > 0) {
      for (const keyword of knowledge.keywords) {
        tags.push(['t', keyword]); // Use 't' tag for keywords (standard Nostr practice)
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

    // Sign the event using nostr-tools
    const signedEvent = finalizeEvent(eventTemplate, secretKey);

    console.log('Event signed, ID:', signedEvent.id);
    console.log('Event pubkey:', signedEvent.pubkey);

    // Publish to relays using SimplePool (same pattern as frontend)
    const pool = new SimplePool();

    try {
      console.log('Publishing to relays...');
      
      // Use same publish pattern as frontend
      const publishPromises = pool.publish(relays, signedEvent);
      const publishArray = Array.from(publishPromises);
      
      let successCount = 0;
      let errorCount = 0;
      const relayResults: { relay: string; success: boolean; error?: string }[] = [];

      await new Promise<void>((resolve, reject) => {
        const timeout = setTimeout(() => {
          console.log(`Publish timeout. Success: ${successCount}, Errors: ${errorCount}`);
          if (successCount === 0) {
            reject(new Error('Publish timeout - no relays responded'));
          } else {
            resolve();
          }
        }, 15000);

        publishArray.forEach((promise, index) => {
          const relayUrl = relays[index] || `relay-${index}`;
          promise
            .then(() => {
              successCount++;
              console.log(`✅ Published to ${relayUrl}`);
              relayResults.push({ relay: relayUrl, success: true });
              if (successCount === 1) {
                clearTimeout(timeout);
                resolve();
              }
            })
            .catch((err) => {
              errorCount++;
              const errMsg = err instanceof Error ? err.message : 'Unknown error';
              console.log(`❌ Failed to publish to ${relayUrl}: ${errMsg}`);
              relayResults.push({ relay: relayUrl, success: false, error: errMsg });
              if (errorCount === publishArray.length) {
                clearTimeout(timeout);
                reject(new Error('All relays failed to publish'));
              }
            });
        });
      });

      console.log(`Published successfully to ${successCount} relay(s)`);

      // Wait a bit for events to propagate
      await new Promise(resolve => setTimeout(resolve, 2000));

    } finally {
      pool.close(relays);
    }

    // Update the knowledge entry with the event ID
    const { error: updateError } = await supabaseClient
      .from('ai_knowledge')
      .update({ nostr_event_id: signedEvent.id })
      .eq('id', knowledgeId);

    if (updateError) {
      console.warn('Failed to update knowledge entry with event ID:', updateError);
    } else {
      console.log('Knowledge entry updated with event ID');
    }

    return new Response(
      JSON.stringify({
        success: true,
        eventId: signedEvent.id,
        pubkey: signedEvent.pubkey,
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