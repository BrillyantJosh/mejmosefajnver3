-- Create table for AI usage logging
CREATE TABLE public.ai_usage_logs (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  nostr_hex_id TEXT NOT NULL,
  model TEXT NOT NULL,
  prompt_tokens INTEGER NOT NULL DEFAULT 0,
  completion_tokens INTEGER NOT NULL DEFAULT 0,
  total_tokens INTEGER NOT NULL DEFAULT 0,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
);

-- Enable RLS
ALTER TABLE public.ai_usage_logs ENABLE ROW LEVEL SECURITY;

-- Users can view their own usage
CREATE POLICY "Users can view their own AI usage"
ON public.ai_usage_logs
FOR SELECT
USING (true);

-- Edge functions can insert usage logs
CREATE POLICY "Service can insert AI usage logs"
ON public.ai_usage_logs
FOR INSERT
WITH CHECK (true);

-- Create index for faster queries by user
CREATE INDEX idx_ai_usage_logs_nostr_hex_id ON public.ai_usage_logs(nostr_hex_id);
CREATE INDEX idx_ai_usage_logs_created_at ON public.ai_usage_logs(created_at DESC);