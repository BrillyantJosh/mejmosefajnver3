import { serve } from "https://deno.land/std@0.168.0/http/server.ts";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }

  try {
    const { url } = await req.json();
    
    if (!url) {
      return new Response(
        JSON.stringify({ error: 'URL is required' }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    console.log('Fetching metadata for URL:', url);
    
    // Try HTTPS first if URL is HTTP
    let fetchUrl = url;
    if (url.startsWith('http://')) {
      fetchUrl = url.replace('http://', 'https://');
      console.log('Converting HTTP to HTTPS:', fetchUrl);
    }
    
    let response;
    let lastError;
    
    try {
      console.log('Attempting fetch with:', fetchUrl);
      response = await fetch(fetchUrl, {
        headers: {
          'User-Agent': 'Mozilla/5.0 (compatible; LanaBot/1.0)',
        },
        redirect: 'follow',
      });
      
      if (!response.ok) {
        lastError = `HTTP ${response.status}: ${response.statusText}`;
        throw new Error(lastError);
      }
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      console.log('Fetch error:', errorMessage);
      
      // If HTTPS fails and we converted from HTTP, try original HTTP
      if (fetchUrl !== url) {
        console.log('HTTPS failed, trying original HTTP URL:', url);
        try {
          response = await fetch(url, {
            headers: {
              'User-Agent': 'Mozilla/5.0 (compatible; LanaBot/1.0)',
            },
            redirect: 'follow',
          });
          
          if (!response.ok) {
            throw new Error(`HTTP ${response.status}: ${response.statusText}`);
          }
        } catch (httpError) {
          const httpErrorMessage = httpError instanceof Error ? httpError.message : String(httpError);
          console.log('HTTP fetch also failed:', httpErrorMessage);
          throw new Error(`Failed to fetch URL (tried both HTTPS and HTTP): ${errorMessage}`);
        }
      } else {
        throw new Error(`Failed to fetch URL: ${errorMessage}`);
      }
    }

    const html = await response.text();

    // Extract OpenGraph metadata
    const ogTitle = html.match(/<meta\s+property=["']og:title["']\s+content=["']([^"']+)["']/i)?.[1];
    const ogDescription = html.match(/<meta\s+property=["']og:description["']\s+content=["']([^"']+)["']/i)?.[1];
    const ogImage = html.match(/<meta\s+property=["']og:image["']\s+content=["']([^"']+)["']/i)?.[1];
    const ogSiteName = html.match(/<meta\s+property=["']og:site_name["']\s+content=["']([^"']+)["']/i)?.[1];

    // Fallback to regular meta tags if OG tags not found
    const title = ogTitle || html.match(/<title>([^<]+)<\/title>/i)?.[1];
    const description = ogDescription || html.match(/<meta\s+name=["']description["']\s+content=["']([^"']+)["']/i)?.[1];

    const metadata = {
      title: title || new URL(url).hostname,
      description: description || '',
      image: ogImage || '',
      siteName: ogSiteName || new URL(url).hostname,
    };

    console.log('Extracted metadata:', metadata);

    return new Response(
      JSON.stringify(metadata),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  } catch (error) {
    console.error('Error fetching URL metadata:', error);
    const errorMessage = error instanceof Error ? error.message : 'Unknown error occurred';
    return new Response(
      JSON.stringify({ error: errorMessage }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  }
});
