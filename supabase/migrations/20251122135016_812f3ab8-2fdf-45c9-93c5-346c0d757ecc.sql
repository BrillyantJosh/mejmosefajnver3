-- Create table for storing KIND 38888 system parameters
CREATE TABLE kind_38888 (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  event_id text NOT NULL UNIQUE,
  pubkey text NOT NULL,
  created_at bigint NOT NULL,
  fetched_at timestamp with time zone DEFAULT now(),
  relays jsonb NOT NULL,
  electrum_servers jsonb NOT NULL,
  exchange_rates jsonb NOT NULL,
  split text,
  version text,
  valid_from bigint,
  trusted_signers jsonb,
  raw_event jsonb NOT NULL
);

-- Index for quick lookup of latest
CREATE INDEX idx_kind_38888_created_at ON kind_38888(created_at DESC);

-- Enable RLS
ALTER TABLE kind_38888 ENABLE ROW LEVEL SECURITY;

-- Policy: Anyone can read system parameters
CREATE POLICY "Anyone can read system parameters"
ON kind_38888
FOR SELECT
USING (true);

-- Policy: Only service role can insert/update
CREATE POLICY "Service role can manage system parameters"
ON kind_38888
FOR ALL
USING (true)
WITH CHECK (true);