-- Create table to track last seen DM timestamps per user
CREATE TABLE public.dm_last_seen (
  nostr_hex_id TEXT PRIMARY KEY,
  last_event_created_at BIGINT NOT NULL DEFAULT 0,
  updated_at TIMESTAMPTZ DEFAULT now()
);

-- Enable RLS
ALTER TABLE public.dm_last_seen ENABLE ROW LEVEL SECURITY;

-- Service role can manage this table (used by edge functions)
CREATE POLICY "Service role can manage dm_last_seen"
  ON public.dm_last_seen FOR ALL
  USING (true) WITH CHECK (true);