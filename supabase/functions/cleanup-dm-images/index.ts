import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.76.1';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

Deno.serve(async (req) => {
  // Handle CORS preflight requests
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    console.log('Starting DM images cleanup process...');

    const supabaseUrl = Deno.env.get('SUPABASE_URL');
    const supabaseServiceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');

    if (!supabaseUrl || !supabaseServiceKey) {
      throw new Error('Missing Supabase environment variables');
    }

    const supabase = createClient(supabaseUrl, supabaseServiceKey);

    // List all files in dm-images bucket
    const { data: files, error: listError } = await supabase.storage
      .from('dm-images')
      .list('', {
        limit: 1000,
        sortBy: { column: 'created_at', order: 'asc' }
      });

    if (listError) {
      console.error('Error listing files:', listError);
      throw listError;
    }

    if (!files || files.length === 0) {
      console.log('No files found in dm-images bucket');
      return new Response(
        JSON.stringify({ 
          message: 'No files to clean up',
          deletedCount: 0 
        }),
        { 
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
          status: 200 
        }
      );
    }

    console.log(`Found ${files.length} files in dm-images bucket`);

    // Calculate date 30 days ago
    const thirtyDaysAgo = new Date();
    thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);
    console.log(`Deleting files older than: ${thirtyDaysAgo.toISOString()}`);

    // Process each file
    const filesToDelete: string[] = [];
    
    for (const file of files) {
      if (file.name) {
        const fileCreatedAt = new Date(file.created_at);
        
        if (fileCreatedAt < thirtyDaysAgo) {
          // Recursively list files in subdirectories if this is a directory
          if (!file.id) {
            const { data: subFiles, error: subListError } = await supabase.storage
              .from('dm-images')
              .list(file.name, {
                limit: 1000,
                sortBy: { column: 'created_at', order: 'asc' }
              });

            if (subListError) {
              console.error(`Error listing subdirectory ${file.name}:`, subListError);
              continue;
            }

            if (subFiles) {
              for (const subFile of subFiles) {
                if (subFile.name) {
                  const subFileCreatedAt = new Date(subFile.created_at);
                  if (subFileCreatedAt < thirtyDaysAgo) {
                    filesToDelete.push(`${file.name}/${subFile.name}`);
                  }
                }
              }
            }
          } else {
            filesToDelete.push(file.name);
          }
        }
      }
    }

    console.log(`Files to delete: ${filesToDelete.length}`);

    if (filesToDelete.length === 0) {
      return new Response(
        JSON.stringify({ 
          message: 'No files older than 30 days found',
          deletedCount: 0 
        }),
        { 
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
          status: 200 
        }
      );
    }

    // Delete files in batches
    const batchSize = 100;
    let deletedCount = 0;
    
    for (let i = 0; i < filesToDelete.length; i += batchSize) {
      const batch = filesToDelete.slice(i, i + batchSize);
      console.log(`Deleting batch ${Math.floor(i / batchSize) + 1}/${Math.ceil(filesToDelete.length / batchSize)}: ${batch.length} files`);
      
      const { error: deleteError } = await supabase.storage
        .from('dm-images')
        .remove(batch);

      if (deleteError) {
        console.error('Error deleting batch:', deleteError);
        continue;
      }

      deletedCount += batch.length;
    }

    console.log(`Successfully deleted ${deletedCount} files`);

    return new Response(
      JSON.stringify({ 
        message: 'Cleanup completed successfully',
        deletedCount,
        totalFiles: files.length
      }),
      { 
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        status: 200 
      }
    );
  } catch (error) {
    console.error('Error in cleanup-dm-images function:', error);
    return new Response(
      JSON.stringify({ error: error instanceof Error ? error.message : 'Unknown error' }),
      { 
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        status: 500 
      }
    );
  }
});
