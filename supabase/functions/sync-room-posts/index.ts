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
    console.log(`📡 Using ${relays.length} relays:`, relays);

    // 2. Fetch rooms manifest from Nostr (KIND 38889)
    const pool = new SimplePool();
    const thirtyDaysAgo = Math.floor(Date.now() / 1000) - (30 * 24 * 60 * 60);

    const ROOMS_PUBKEY = "b66ccf84bc6cf1a56ba9941f29932824f4986803358a0bed03769a1cbf480101";
    
    // Fetch rooms manifest - specific author and d-tag
    const roomManifestEvents = await pool.querySync(relays, {
      kinds: [38889],
      authors: [ROOMS_PUBKEY],
      '#d': ['rooms'],
      limit: 1
    });

    console.log(`🏠 Found ${roomManifestEvents.length} room manifest events`);

    if (roomManifestEvents.length === 0) {
      console.log('No rooms manifest found');
      pool.close(relays);
      return new Response(
        JSON.stringify({ success: true, roomsProcessed: 0, message: 'No rooms manifest found' }),
        { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // Get the latest manifest
    const manifest = roomManifestEvents.reduce((latest: any, event: any) => {
      if (!latest || event.created_at > latest.created_at) return event;
      return latest;
    }, null);

    // Parse rooms from tags
    const roomTags = manifest.tags.filter((t: string[]) => t[0] === 'room');
    const roomsToProcess: { slug: string; title: string }[] = roomTags.map((tag: string[]) => ({
      slug: tag[1],
      title: tag[2] || tag[1]
    }));

    console.log(`📝 Processing ${roomsToProcess.length} rooms`);

    // 3. For each room, fetch latest posts and count
    const results: any[] = [];

    for (const room of roomsToProcess) {
      try {
        console.log(`🔍 Fetching posts for room: ${room.slug}`);
        
        // Fetch posts for this room (KIND 1 with #t tag) - no since filter first
        const posts = await pool.querySync(relays, {
          kinds: [1],
          '#t': [room.slug],
          limit: 50
        });

        console.log(`   Found ${posts.length} posts with #t tag`);

        // Also try with #a tag (just slug, not with kind prefix)
        const postsWithA = await pool.querySync(relays, {
          kinds: [1],
          '#a': [room.slug],
          limit: 50
        });

        console.log(`   Found ${postsWithA.length} posts with #a tag`);

        // Combine and dedupe
        const allPosts = [...posts, ...postsWithA];
        const uniquePosts = Array.from(
          new Map(allPosts.map((p: any) => [p.id, p])).values()
        );

        // Sort by created_at desc
        uniquePosts.sort((a: any, b: any) => b.created_at - a.created_at);

        // Count posts from last 30 days
        const postCount = uniquePosts.filter((p: any) => p.created_at >= thirtyDaysAgo).length;
        const latestPost = uniquePosts[0] as any;

        if (latestPost) {
          // Try to find image from latest posts
          let imageUrl = extractImageFromPost(latestPost);
          if (!imageUrl) {
            for (let i = 1; i < Math.min(uniquePosts.length, 5); i++) {
              imageUrl = extractImageFromPost(uniquePosts[i]);
              if (imageUrl) break;
            }
          }

          results.push({
            room_slug: room.slug,
            post_event_id: latestPost.id,
            content: latestPost.content?.substring(0, 500) || '',
            author_pubkey: latestPost.pubkey,
            created_at: latestPost.created_at,
            image_url: imageUrl,
            post_count: postCount,
            fetched_at: new Date().toISOString()
          });
          console.log(`   ✅ Added ${room.slug} with ${postCount} posts (last 30d)`);
        } else {
          console.log(`   ⚠️ No posts found for ${room.slug}`);
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
