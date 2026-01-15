import { serve } from "https://deno.land/std@0.168.0/http/server.ts";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

interface SearchResult {
  pubkey: string;
  name: string;
  displayName: string;
  picture?: string;
  wallets: {
    walletId: string;
    walletType: string;
    note: string;
  }[];
}

// Default relays if none provided
const DEFAULT_RELAYS = [
  'wss://relay.damus.io',
  'wss://relay.nostr.band',
  'wss://nos.lol',
];

async function queryRelay(relayUrl: string, filter: any, timeout = 10000): Promise<any[]> {
  return new Promise((resolve) => {
    const events: any[] = [];
    let socket: WebSocket | null = null;
    
    const timeoutId = setTimeout(() => {
      if (socket) socket.close();
      resolve(events);
    }, timeout);

    try {
      socket = new WebSocket(relayUrl);
      
      socket.onopen = () => {
        const subId = Math.random().toString(36).substring(7);
        socket!.send(JSON.stringify(['REQ', subId, filter]));
      };

      socket.onmessage = (event) => {
        try {
          const data = JSON.parse(event.data);
          if (data[0] === 'EVENT') {
            events.push(data[2]);
          } else if (data[0] === 'EOSE') {
            clearTimeout(timeoutId);
            socket!.close();
            resolve(events);
          }
        } catch (e) {
          // Ignore parse errors
        }
      };

      socket.onerror = () => {
        clearTimeout(timeoutId);
        resolve(events);
      };

      socket.onclose = () => {
        clearTimeout(timeoutId);
        resolve(events);
      };
    } catch (e) {
      clearTimeout(timeoutId);
      resolve(events);
    }
  });
}

serve(async (req) => {
  // Handle CORS preflight requests
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const { searchQuery, relays: providedRelays } = await req.json();

    if (!searchQuery || searchQuery.trim().length < 2) {
      return new Response(
        JSON.stringify({ error: 'Search query must be at least 2 characters' }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    const relays = providedRelays?.length > 0 ? providedRelays : DEFAULT_RELAYS;
    const query = searchQuery.toLowerCase().trim();

    console.log(`🔍 Searching for "${query}" across ${relays.length} relays`);

    // Search for profiles (kind 0) across all relays
    const profilePromises = relays.slice(0, 3).map((relay: string) => 
      queryRelay(relay, { kinds: [0], limit: 500 }, 8000)
    );

    const allProfileEvents = await Promise.all(profilePromises);
    const uniqueProfiles = new Map<string, any>();

    // Deduplicate and filter profiles by name match
    for (const events of allProfileEvents) {
      for (const event of events) {
        if (uniqueProfiles.has(event.pubkey)) continue;
        
        try {
          const profile = JSON.parse(event.content);
          const name = (profile.name || '').toLowerCase();
          const displayName = (profile.display_name || '').toLowerCase();
          const nip05 = (profile.nip05 || '').toLowerCase();

          if (name.includes(query) || displayName.includes(query) || nip05.includes(query)) {
            uniqueProfiles.set(event.pubkey, {
              pubkey: event.pubkey,
              name: profile.name || '',
              displayName: profile.display_name || profile.name || '',
              picture: profile.picture,
              created_at: event.created_at,
            });
          }
        } catch (e) {
          // Skip invalid profiles
        }
      }
    }

    console.log(`📋 Found ${uniqueProfiles.size} matching profiles`);

    if (uniqueProfiles.size === 0) {
      return new Response(
        JSON.stringify({ results: [], message: 'No matching profiles found' }),
        { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // Fetch wallets for matching profiles (kind 30889)
    const results: SearchResult[] = [];
    const pubkeys = Array.from(uniqueProfiles.keys()).slice(0, 10); // Limit to 10 profiles

    for (const pubkey of pubkeys) {
      const profile = uniqueProfiles.get(pubkey)!;
      
      // Query wallets for this pubkey
      const walletPromises = relays.slice(0, 2).map((relay: string) =>
        queryRelay(relay, { kinds: [30889], '#d': [pubkey], limit: 20 }, 5000)
      );

      const allWalletEvents = await Promise.all(walletPromises);
      const wallets: { walletId: string; walletType: string; note: string }[] = [];
      const seenWallets = new Set<string>();

      for (const events of allWalletEvents) {
        for (const event of events) {
          const wTags = event.tags?.filter((tag: string[]) => tag[0] === 'w') || [];
          for (const tag of wTags) {
            if (tag.length >= 3 && !seenWallets.has(tag[1])) {
              seenWallets.add(tag[1]);
              wallets.push({
                walletId: tag[1],
                walletType: tag[2],
                note: tag[4] || '',
              });
            }
          }
        }
      }

      if (wallets.length > 0) {
        results.push({
          pubkey: profile.pubkey,
          name: profile.name,
          displayName: profile.displayName,
          picture: profile.picture,
          wallets,
        });
      }
    }

    console.log(`✅ Returning ${results.length} profiles with wallets`);

    return new Response(
      JSON.stringify({ results }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );

  } catch (error) {
    console.error('Search error:', error);
    return new Response(
      JSON.stringify({ error: error instanceof Error ? error.message : 'Search failed' }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  }
});
