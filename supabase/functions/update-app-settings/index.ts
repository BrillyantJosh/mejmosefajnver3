import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.76.1';
import { serve } from 'https://deno.land/std@0.168.0/http/server.ts';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

serve(async (req) => {
  // Handle CORS preflight requests
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const { nostrHexId, key, value } = await req.json();

    console.log('🔍 [update-app-settings] Received request:', { nostrHexId, key });

    if (!nostrHexId || !key || !value) {
      console.error('❌ [update-app-settings] Missing required fields');
      return new Response(
        JSON.stringify({ error: 'Missing required fields: nostrHexId, key, value' }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // Create Supabase client with anon key for admin check
    const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
    const supabaseAnonKey = Deno.env.get('SUPABASE_ANON_KEY')!;
    const supabaseClient = createClient(supabaseUrl, supabaseAnonKey);

    // Check if user is admin
    console.log('🔍 [update-app-settings] Checking admin status for:', nostrHexId);
    const { data: adminData, error: adminError } = await supabaseClient
      .from('admin_users')
      .select('nostr_hex_id')
      .eq('nostr_hex_id', nostrHexId)
      .maybeSingle();

    if (adminError) {
      console.error('❌ [update-app-settings] Error checking admin status:', adminError);
      return new Response(
        JSON.stringify({ error: 'Failed to verify admin status' }),
        { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    if (!adminData) {
      console.error('❌ [update-app-settings] User is not an admin');
      return new Response(
        JSON.stringify({ error: 'Unauthorized: User is not an admin' }),
        { status: 403, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    console.log('✅ [update-app-settings] User is admin, proceeding with update');

    // Create Supabase client with service role key for update
    const supabaseServiceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
    const supabaseServiceClient = createClient(supabaseUrl, supabaseServiceKey);

    // Update app settings
    const { error: updateError } = await supabaseServiceClient
      .from('app_settings')
      .update({ value: value })
      .eq('key', key);

    if (updateError) {
      console.error('❌ [update-app-settings] Error updating settings:', updateError);
      return new Response(
        JSON.stringify({ error: 'Failed to update app settings' }),
        { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    console.log('✅ [update-app-settings] Successfully updated app settings');

    return new Response(
      JSON.stringify({ success: true, message: 'App settings updated successfully' }),
      { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  } catch (error) {
    console.error('❌ [update-app-settings] Unexpected error:', error);
    return new Response(
      JSON.stringify({ error: 'Internal server error' }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  }
});
