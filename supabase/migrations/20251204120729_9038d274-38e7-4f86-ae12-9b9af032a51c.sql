-- Create lash_users_history table for tracking who LASHed which posts
CREATE TABLE public.lash_users_history (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  event_id TEXT NOT NULL,
  nostr_hex_id TEXT NOT NULL,
  created_at TIMESTAMPTZ DEFAULT now(),
  
  -- Prevent duplicate LASHes
  UNIQUE(event_id, nostr_hex_id)
);

-- Enable RLS
ALTER TABLE public.lash_users_history ENABLE ROW LEVEL SECURITY;

-- Anyone can read (to show green hearts)
CREATE POLICY "Anyone can read lash history" 
ON public.lash_users_history 
FOR SELECT 
USING (true);

-- Anyone can insert (when giving LASH)
CREATE POLICY "Anyone can insert lash" 
ON public.lash_users_history 
FOR INSERT 
WITH CHECK (true);

-- Create index for faster lookups
CREATE INDEX idx_lash_users_history_nostr_hex_id ON public.lash_users_history(nostr_hex_id);
CREATE INDEX idx_lash_users_history_event_id ON public.lash_users_history(event_id);