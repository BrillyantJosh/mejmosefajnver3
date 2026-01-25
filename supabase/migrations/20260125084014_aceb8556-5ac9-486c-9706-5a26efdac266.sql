-- Create table for storing push notification subscriptions
-- Only stores browser-generated public data, NO user private keys
CREATE TABLE public.push_subscriptions (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  nostr_hex_id TEXT NOT NULL,
  endpoint TEXT NOT NULL,
  p256dh TEXT NOT NULL,
  auth TEXT NOT NULL,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  UNIQUE(nostr_hex_id, endpoint)
);

-- Enable RLS
ALTER TABLE public.push_subscriptions ENABLE ROW LEVEL SECURITY;

-- Users can manage their own subscriptions (no auth.uid needed, we use nostr_hex_id)
CREATE POLICY "Anyone can insert subscriptions"
  ON public.push_subscriptions
  FOR INSERT
  WITH CHECK (true);

CREATE POLICY "Anyone can view subscriptions"
  ON public.push_subscriptions
  FOR SELECT
  USING (true);

CREATE POLICY "Anyone can update their subscriptions"
  ON public.push_subscriptions
  FOR UPDATE
  USING (true);

CREATE POLICY "Anyone can delete their subscriptions"
  ON public.push_subscriptions
  FOR DELETE
  USING (true);

-- Index for fast lookups
CREATE INDEX idx_push_subscriptions_nostr_hex_id ON public.push_subscriptions(nostr_hex_id);

-- Trigger for updated_at
CREATE TRIGGER update_push_subscriptions_updated_at
  BEFORE UPDATE ON public.push_subscriptions
  FOR EACH ROW
  EXECUTE FUNCTION public.update_updated_at_column();