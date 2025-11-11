// This edge function has been deprecated and removed
// Image proxying is now handled by frontend function getProxiedImageUrl()

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  console.log('⚠️ proxy-image function called but is deprecated');

  return new Response(
    JSON.stringify({ 
      error: 'This function has been deprecated. Image proxying is now handled client-side.' 
    }),
    { 
      status: 410, // Gone
      headers: { ...corsHeaders, 'Content-Type': 'application/json' } 
    }
  );
});
