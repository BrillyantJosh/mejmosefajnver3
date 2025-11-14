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
    
    const fetchWithTimeout = async (fetchUrl: string, timeout = 10000) => {
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), timeout);
      
      try {
        const response = await fetch(fetchUrl, {
          headers: {
            'User-Agent': 'Mozilla/5.0 (compatible; LanaBot/1.0)',
          },
          redirect: 'follow',
          signal: controller.signal,
        });
        clearTimeout(timeoutId);
        return response;
      } catch (error) {
        clearTimeout(timeoutId);
        throw error;
      }
    };
    
    let response;
    let fetchUrl = url;
    
    // Try original URL first
    try {
      console.log('Attempting fetch with:', fetchUrl);
      response = await fetchWithTimeout(fetchUrl);
      
      if (!response.ok) {
        throw new Error(`HTTP ${response.status}: ${response.statusText}`);
      }
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      console.log('Initial fetch error:', errorMessage);
      
      // If original was HTTP and it failed, try HTTPS
      if (url.startsWith('http://') && !url.startsWith('https://')) {
        fetchUrl = url.replace('http://', 'https://');
        console.log('Trying HTTPS variant:', fetchUrl);
        
        try {
          response = await fetchWithTimeout(fetchUrl);
          
          if (!response.ok) {
            throw new Error(`HTTP ${response.status}: ${response.statusText}`);
          }
        } catch (httpsError) {
          const httpsErrorMessage = httpsError instanceof Error ? httpsError.message : String(httpsError);
          console.log('HTTPS fetch also failed:', httpsErrorMessage);
          
          // Return a basic fallback metadata instead of throwing
          const hostname = new URL(url).hostname;
          return new Response(
            JSON.stringify({
              title: hostname,
              description: '',
              image: '',
              siteName: hostname,
            }),
            { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
          );
        }
      } else {
        // For HTTPS URLs that fail or other errors, return fallback
        const hostname = new URL(url).hostname;
        return new Response(
          JSON.stringify({
            title: hostname,
            description: '',
            image: '',
            siteName: hostname,
          }),
          { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        );
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
