import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.76.1";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

serve(async (req) => {
  // Handle CORS preflight
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    console.log('Starting dm-audio cleanup job...');

    // Initialize Supabase with service role
    const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
    const supabaseServiceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
    
    const supabase = createClient(supabaseUrl, supabaseServiceKey);

    // Calculate cutoff date (7 days ago)
    const cutoffDate = new Date();
    cutoffDate.setDate(cutoffDate.getDate() - 7);
    
    console.log(`Cutoff date: ${cutoffDate.toISOString()}`);

    // List all files in dm-audio bucket
    const { data: files, error: listError } = await supabase.storage
      .from('dm-audio')
      .list('', {
        limit: 1000,
        sortBy: { column: 'created_at', order: 'asc' }
      });

    if (listError) {
      throw new Error(`Error listing files: ${listError.message}`);
    }

    console.log(`Found ${files?.length || 0} total files in bucket`);

    // Filter files older than 7 days
    const filesToDelete = files?.filter(file => {
      const fileDate = new Date(file.created_at);
      return fileDate < cutoffDate;
    }) || [];

    console.log(`Deleting ${filesToDelete.length} files older than ${cutoffDate.toISOString()}`);

    if (filesToDelete.length === 0) {
      return new Response(
        JSON.stringify({
          success: true,
          deleted: 0,
          message: 'No files to delete',
          cutoff_date: cutoffDate.toISOString()
        }),
        { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // Delete files in batches of 100
    const batchSize = 100;
    let totalDeleted = 0;

    for (let i = 0; i < filesToDelete.length; i += batchSize) {
      const batch = filesToDelete.slice(i, i + batchSize);
      const paths = batch.map(f => f.name);

      console.log(`Deleting batch ${Math.floor(i / batchSize) + 1}: ${paths.length} files`);

      const { error: deleteError } = await supabase.storage
        .from('dm-audio')
        .remove(paths);

      if (deleteError) {
        console.error(`Error deleting batch: ${deleteError.message}`);
      } else {
        totalDeleted += paths.length;
      }
    }

    console.log(`Successfully deleted ${totalDeleted} files`);

    return new Response(
      JSON.stringify({
        success: true,
        deleted: totalDeleted,
        cutoff_date: cutoffDate.toISOString(),
        message: `Deleted ${totalDeleted} files older than 7 days`
      }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );

  } catch (error) {
    console.error('Error in cleanup function:', error);
    const errorMessage = error instanceof Error ? error.message : 'Unknown error occurred';
    
    return new Response(
      JSON.stringify({ 
        success: false,
        error: errorMessage 
      }),
      { 
        status: 500, 
        headers: { ...corsHeaders, 'Content-Type': 'application/json' } 
      }
    );
  }
});
