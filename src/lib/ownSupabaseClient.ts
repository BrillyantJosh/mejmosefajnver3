import { createClient } from '@supabase/supabase-js';

// Separate Supabase client for OWN audio storage
const OWN_SUPABASE_URL = 'https://saaodlxrptrtgasajxlx.supabase.co';
const OWN_SUPABASE_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InNhYW9kbHhycHRydGdhc2FqeGx4Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3NjM0NjI5MjIsImV4cCI6MjA3OTAzODkyMn0.5aWi444ICC2HgF81zI75UGVWJ96ktTBoUiMDBAQGRhU';

export const ownSupabase = createClient(OWN_SUPABASE_URL, OWN_SUPABASE_ANON_KEY, {
  auth: {
    persistSession: false,
    autoRefreshToken: false,
  }
});

export const OWN_PROJECT_ID = 'saaodlxrptrtgasajxlx';
