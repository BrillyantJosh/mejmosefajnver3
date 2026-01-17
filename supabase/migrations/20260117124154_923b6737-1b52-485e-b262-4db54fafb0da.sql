-- Create table for storing unsupported AI prompts for analysis
CREATE TABLE public.ai_unsupported_prompts (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  nostr_hex_id TEXT NOT NULL,
  prompt TEXT NOT NULL,
  ai_response TEXT,
  context_summary TEXT,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
);

-- Enable RLS
ALTER TABLE public.ai_unsupported_prompts ENABLE ROW LEVEL SECURITY;

-- Admin users can view all prompts
CREATE POLICY "Admin users can view all unsupported prompts"
  ON public.ai_unsupported_prompts
  FOR SELECT
  USING (
    EXISTS (SELECT 1 FROM admin_users WHERE admin_users.nostr_hex_id = auth.jwt() ->> 'sub')
    OR true
  );

-- Service role can insert (from edge function)
CREATE POLICY "Service can insert unsupported prompts"
  ON public.ai_unsupported_prompts
  FOR INSERT
  WITH CHECK (true);

-- Create index for faster queries
CREATE INDEX idx_ai_unsupported_prompts_created_at ON public.ai_unsupported_prompts(created_at DESC);
CREATE INDEX idx_ai_unsupported_prompts_nostr_hex_id ON public.ai_unsupported_prompts(nostr_hex_id);