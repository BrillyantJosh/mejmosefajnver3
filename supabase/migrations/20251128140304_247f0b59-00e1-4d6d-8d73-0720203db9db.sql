-- Create dm_lashes table for caching LASH events
CREATE TABLE IF NOT EXISTS public.dm_lashes (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  message_event_id TEXT NOT NULL,
  lash_event_id TEXT NOT NULL UNIQUE,
  sender_pubkey TEXT NOT NULL,
  recipient_pubkey TEXT NOT NULL,
  amount TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  expires_at TIMESTAMPTZ
);

-- Indexes for fast querying
CREATE INDEX IF NOT EXISTS idx_dm_lashes_message ON public.dm_lashes(message_event_id);
CREATE INDEX IF NOT EXISTS idx_dm_lashes_sender ON public.dm_lashes(sender_pubkey);
CREATE INDEX IF NOT EXISTS idx_dm_lashes_created ON public.dm_lashes(created_at DESC);

-- Enable Row Level Security
ALTER TABLE public.dm_lashes ENABLE ROW LEVEL SECURITY;

-- Allow users to read all lashes (needed for chat messages)
CREATE POLICY "Users can view all lashes" 
  ON public.dm_lashes 
  FOR SELECT 
  USING (true);

-- Allow users to insert their own lashes
CREATE POLICY "Users can insert lashes" 
  ON public.dm_lashes 
  FOR INSERT 
  WITH CHECK (true);