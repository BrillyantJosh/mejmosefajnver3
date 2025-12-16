import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { SimplePool } from "https://esm.sh/nostr-tools@2.7.0";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

const DEFAULT_RELAYS = [
  "wss://relay.damus.io",
  "wss://nos.lol",
  "wss://relay.nostr.band"
];

// Extract image URL from post content and tags
function extractImageFromPost(event: any): string | undefined {
  // Check for image tag first
  const imageTag = event.tags?.find((t: string[]) => t[0] === 'image');
  if (imageTag?.[1]) return imageTag[1];

  // Check for 'r' tag with image URL
  const rTags = event.tags?.filter((t: string[]) => t[0] === 'r');
  for (const tag of rTags || []) {
    const url = tag[1];
    if (url && /\.(jpg|jpeg|png|gif|webp|avif)(\?.*)?$/i.test(url)) {
      return url;
    }
  }

  // Check content for image URLs
  const content = event.content || '';
  
  // YouTube thumbnail
  const youtubeMatch = content.match(/(?:youtube\.com\/watch\?v=|youtu\.be\/|youtube\.com\/embed\/)([a-zA-Z0-9_-]{11})/);
  if (youtubeMatch) {
    return `https://img.youtube.com/vi/${youtubeMatch[1]}/hqdefault.jpg`;
  }

  // Direct image URL in content
  const imageUrlMatch = content.match(/(https?:\/\/[^\s]+\.(?:jpg|jpeg|png|gif|webp|avif)(?:\?[^\s]*)?)/i);
  if (imageUrlMatch) {
    return imageUrlMatch[1];
  }

  return undefined;
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
  const supabaseServiceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
  const supabase = createClient(supabaseUrl, supabaseServiceKey);

  console.log('🔄 Starting sync-room-posts...');

  try {
    // 1. Get relays from kind_38888
    const { data: systemParams } = await supabase
      .from('kind_38888')
      .select('relays')
      .order('fetched_at', { ascending: false })
      .limit(1)
      .single();

    const relays: string[] = systemParams?.relays || DEFAULT_RELAYS;
    console.log(`📡 Using ${relays.length} relays`);

    // 2. Fetch rooms from Nostr (KIND 38889)
    const pool = new SimplePool();
    const thirtyDaysAgo = Math.floor(Date.now() / 1000) - (30 * 24 * 60 * 60);

    // Fetch rooms
    const roomEvents = await pool.querySync(relays, {
      kinds: [38889],
      limit: 100
    });

    console.log(`🏠 Found ${roomEvents.length} rooms`);

    const roomsToProcess: { slug: string; title: string }[] = [];
    for (const event of roomEvents) {
      const dTag = event.tags.find((t: string[]) => t[0] === 'd');
      const titleTag = event.tags.find((t: string[]) => t[0] === 'title');
      if (dTag?.[1]) {
        roomsToProcess.push({
          slug: dTag[1],
          title: titleTag?.[1] || dTag[1]
        });
      }
    }

    console.log(`📝 Processing ${roomsToProcess.length} rooms`);

    // 3. For each room, fetch latest posts and count
    const results: any[] = [];

    for (const room of roomsToProcess) {
      try {
        // Fetch posts for this room (KIND 1 with #t or #a tag)
        const posts = await pool.querySync(relays, {
          kinds: [1],
          '#t': [room.slug],
          since: thirtyDaysAgo,
          limit: 100
        });

        // Also try with #a tag for addressable events
        const postsWithA = await pool.querySync(relays, {
          kinds: [1],
          '#a': [`38889:${room.slug}`],
          since: thirtyDaysAgo,
          limit: 100
        });

        // Combine and dedupe
        const allPosts = [...posts, ...postsWithA];
        const uniquePosts = Array.from(
          new Map(allPosts.map(p => [p.id, p])).values()
        );

        // Sort by created_at desc
        uniquePosts.sort((a, b) => b.created_at - a.created_at);

        const postCount = uniquePosts.length;
        const latestPost = uniquePosts[0];

        if (latestPost) {
          results.push({
            room_slug: room.slug,
            post_event_id: latestPost.id,
            content: latestPost.content?.substring(0, 500) || '',
            author_pubkey: latestPost.pubkey,
            created_at: latestPost.created_at,
            image_url: extractImageFromPost(latestPost),
            post_count: postCount,
            fetched_at: new Date().toISOString()
          });
        }
      } catch (roomError) {
        console.error(`Error processing room ${room.slug}:`, roomError);
      }
    }

    console.log(`✅ Processed ${results.length} rooms with posts`);

    // 4. Upsert to database
    if (results.length > 0) {
      const { error: upsertError } = await supabase
        .from('room_latest_posts')
        .upsert(results, { 
          onConflict: 'room_slug',
          ignoreDuplicates: false 
        });

      if (upsertError) {
        console.error('Upsert error:', upsertError);
        throw upsertError;
      }

      console.log(`💾 Upserted ${results.length} room posts to database`);
    }

    // Close pool
    pool.close(relays);

    return new Response(
      JSON.stringify({ 
        success: true, 
        roomsProcessed: results.length,
        timestamp: new Date().toISOString()
      }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );

  } catch (error) {
    console.error('❌ Error in sync-room-posts:', error);
    const errorMessage = error instanceof Error ? error.message : 'Unknown error';
    return new Response(
      JSON.stringify({ success: false, error: errorMessage }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  }
});
