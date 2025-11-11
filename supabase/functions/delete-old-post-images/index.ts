import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.7.1'

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders })
  }

  try {
    console.log('Starting cleanup of old post images...')
    
    const supabase = createClient(
      Deno.env.get('SUPABASE_URL') ?? '',
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''
    )

    // Calculate the date 60 days ago
    const sixtyDaysAgo = new Date()
    sixtyDaysAgo.setDate(sixtyDaysAgo.getDate() - 60)
    
    console.log(`Looking for images older than: ${sixtyDaysAgo.toISOString()}`)

    // List all files in post-images bucket
    const { data: files, error: listError } = await supabase
      .storage
      .from('post-images')
      .list()

    if (listError) {
      console.error('Error listing files:', listError)
      throw listError
    }

    console.log(`Found ${files?.length || 0} total files`)

    if (!files || files.length === 0) {
      console.log('No files to process')
      return new Response(
        JSON.stringify({ message: 'No files found', deleted: 0 }),
        { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      )
    }

    // Filter files older than 60 days
    const oldFiles = files.filter(file => {
      const fileDate = new Date(file.created_at)
      return fileDate < sixtyDaysAgo
    })

    console.log(`Found ${oldFiles.length} files older than 60 days`)

    if (oldFiles.length === 0) {
      console.log('No old files to delete')
      return new Response(
        JSON.stringify({ message: 'No old files to delete', deleted: 0 }),
        { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      )
    }

    // Delete old files
    const filePaths = oldFiles.map(file => file.name)
    const { data: deleteData, error: deleteError } = await supabase
      .storage
      .from('post-images')
      .remove(filePaths)

    if (deleteError) {
      console.error('Error deleting files:', deleteError)
      throw deleteError
    }

    console.log(`Successfully deleted ${oldFiles.length} files`)
    console.log('Deleted files:', filePaths)

    return new Response(
      JSON.stringify({ 
        message: 'Cleanup completed successfully',
        deleted: oldFiles.length,
        files: filePaths
      }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    )

  } catch (error) {
    console.error('Error in cleanup function:', error)
    return new Response(
      JSON.stringify({ 
        error: error instanceof Error ? error.message : 'Unknown error',
        details: error
      }),
      { 
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        status: 500
      }
    )
  }
})
