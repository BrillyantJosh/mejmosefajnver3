
-- Migration: 20251023051104
-- Create enum for roles
CREATE TYPE public.app_role AS ENUM ('admin', 'moderator', 'user');

-- Create user_roles table for role-based access control
CREATE TABLE public.user_roles (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID REFERENCES auth.users(id) ON DELETE CASCADE NOT NULL,
  role app_role NOT NULL,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT now(),
  UNIQUE (user_id, role)
);

ALTER TABLE public.user_roles ENABLE ROW LEVEL SECURITY;

-- Security definer function to check if user has a role
CREATE OR REPLACE FUNCTION public.has_role(_user_id UUID, _role app_role)
RETURNS BOOLEAN
LANGUAGE SQL
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.user_roles
    WHERE user_id = _user_id
      AND role = _role
  )
$$;

-- Policy: Authenticated users can view their own roles
CREATE POLICY "Users can view their own roles"
ON public.user_roles
FOR SELECT
TO authenticated
USING (user_id = auth.uid());

-- Policy: Admins can view all roles
CREATE POLICY "Admins can view all roles"
ON public.user_roles
FOR SELECT
TO authenticated
USING (public.has_role(auth.uid(), 'admin'));

-- Create admin_users table (stores nostr_hex_id for admin identification)
CREATE TABLE public.admin_users (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  nostr_hex_id TEXT UNIQUE NOT NULL,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT now(),
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT now()
);

ALTER TABLE public.admin_users ENABLE ROW LEVEL SECURITY;

-- Policy: Admins can view admin users
CREATE POLICY "Admins can view admin users"
ON public.admin_users
FOR SELECT
TO authenticated
USING (public.has_role(auth.uid(), 'admin'));

-- Create app_settings table
CREATE TABLE public.app_settings (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  key TEXT UNIQUE NOT NULL,
  value JSONB NOT NULL,
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT now(),
  updated_by UUID REFERENCES auth.users(id)
);

ALTER TABLE public.app_settings ENABLE ROW LEVEL SECURITY;

-- Policy: Anyone can read app settings
CREATE POLICY "Anyone can read app settings"
ON public.app_settings
FOR SELECT
USING (true);

-- Policy: Only admins can update app settings
CREATE POLICY "Only admins can update app settings"
ON public.app_settings
FOR INSERT
TO authenticated
WITH CHECK (public.has_role(auth.uid(), 'admin'));

CREATE POLICY "Only admins can modify app settings"
ON public.app_settings
FOR UPDATE
TO authenticated
USING (public.has_role(auth.uid(), 'admin'));

-- Insert default app settings
INSERT INTO public.app_settings (key, value)
VALUES 
  ('app_name', '"Nostr App"'::jsonb),
  ('theme_colors', '{
    "primary": "263 70% 50%",
    "primary_foreground": "0 0% 100%",
    "secondary": "240 5% 96%",
    "secondary_foreground": "240 10% 15%",
    "accent": "263 70% 50%",
    "accent_foreground": "0 0% 100%",
    "background": "0 0% 100%",
    "foreground": "240 10% 15%"
  }'::jsonb);

-- Create function to update updated_at timestamp
CREATE OR REPLACE FUNCTION public.update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SET search_path = public;

-- Add trigger for app_settings
CREATE TRIGGER update_app_settings_updated_at
BEFORE UPDATE ON public.app_settings
FOR EACH ROW
EXECUTE FUNCTION public.update_updated_at_column();

-- Add trigger for admin_users
CREATE TRIGGER update_admin_users_updated_at
BEFORE UPDATE ON public.admin_users
FOR EACH ROW
EXECUTE FUNCTION public.update_updated_at_column();

-- Migration: 20251023085910
-- Phase 1: Fix RLS for admin_users to allow public SELECT
DROP POLICY IF EXISTS "Admins can view admin users" ON admin_users;

CREATE POLICY "Anyone can view admin users"
ON admin_users
FOR SELECT
TO public
USING (true);

-- Phase 2 (temporary): Allow public UPDATE on app_settings for testing
DROP POLICY IF EXISTS "Only admins can modify app settings" ON app_settings;

CREATE POLICY "Temporary public update for app settings"
ON app_settings
FOR UPDATE
TO public
USING (true)
WITH CHECK (true);

-- Note: This temporary policy will be replaced by secure Edge Function approach in Phase 3;

-- Migration: 20251023104718
-- Create table for tracking read/unread status of Nostr DM messages
CREATE TABLE IF NOT EXISTS public.dm_read_status (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_nostr_id TEXT NOT NULL,
  message_event_id TEXT NOT NULL,
  sender_pubkey TEXT NOT NULL,
  conversation_pubkey TEXT NOT NULL,
  is_read BOOLEAN NOT NULL DEFAULT false,
  read_at TIMESTAMP WITH TIME ZONE,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  
  UNIQUE(user_nostr_id, message_event_id)
);

-- Indexes for performance
CREATE INDEX idx_dm_read_status_user ON public.dm_read_status(user_nostr_id);
CREATE INDEX idx_dm_read_status_conversation_unread ON public.dm_read_status(user_nostr_id, conversation_pubkey, is_read);
CREATE INDEX idx_dm_read_status_sender ON public.dm_read_status(sender_pubkey);

-- Trigger for updated_at
CREATE TRIGGER update_dm_read_status_updated_at
  BEFORE UPDATE ON public.dm_read_status
  FOR EACH ROW
  EXECUTE FUNCTION update_updated_at_column();

-- Enable RLS
ALTER TABLE public.dm_read_status ENABLE ROW LEVEL SECURITY;

-- RLS Policies (public for now since we're using nostr_hex_id not auth.uid())
CREATE POLICY "Users can view all read status"
  ON public.dm_read_status
  FOR SELECT
  USING (true);

CREATE POLICY "Users can insert read status"
  ON public.dm_read_status
  FOR INSERT
  WITH CHECK (true);

CREATE POLICY "Users can update read status"
  ON public.dm_read_status
  FOR UPDATE
  USING (true)
  WITH CHECK (true);

CREATE POLICY "Users can delete read status"
  ON public.dm_read_status
  FOR DELETE
  USING (true);

COMMENT ON TABLE public.dm_read_status IS 'Tracks read/unread status of Nostr DM messages per user';
COMMENT ON COLUMN public.dm_read_status.user_nostr_id IS 'Nostr hex public key of the user';
COMMENT ON COLUMN public.dm_read_status.message_event_id IS 'Nostr event ID (KIND 4) of the DM message';
COMMENT ON COLUMN public.dm_read_status.sender_pubkey IS 'Public key of the message sender';
COMMENT ON COLUMN public.dm_read_status.conversation_pubkey IS 'Public key of the other person in conversation';
COMMENT ON COLUMN public.dm_read_status.is_read IS 'Whether the message has been read by the user';
COMMENT ON COLUMN public.dm_read_status.read_at IS 'Timestamp when message was marked as read';

-- Migration: 20251028090534
-- Create wallet_types table
CREATE TABLE IF NOT EXISTS public.wallet_types (
  id uuid NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  name text NOT NULL UNIQUE,
  description text,
  is_active boolean NOT NULL DEFAULT true,
  display_order integer NOT NULL DEFAULT 0,
  created_at timestamp with time zone NOT NULL DEFAULT now(),
  updated_at timestamp with time zone NOT NULL DEFAULT now()
);

-- Enable RLS
ALTER TABLE public.wallet_types ENABLE ROW LEVEL SECURITY;

-- Allow everyone to read wallet types
CREATE POLICY "Anyone can read wallet types"
  ON public.wallet_types
  FOR SELECT
  USING (is_active = true);

-- Insert default wallet types
INSERT INTO public.wallet_types (name, description, display_order) VALUES
  ('Main Wallet', 'Primary wallet for daily transactions', 1),
  ('Savings Wallet', 'Long-term savings and storage', 2),
  ('Trading Wallet', 'Used for trading activities', 3),
  ('Business Wallet', 'Business-related transactions', 4),
  ('LanaLovesUK', 'UK-based Lana Loves operations', 5),
  ('LanaLovesSlovenia', 'Slovenia-based Lana Loves operations', 6),
  ('Custom', 'Custom wallet type', 99)
ON CONFLICT (name) DO NOTHING;

-- Migration: 20251103120302
-- Create storage bucket for post images
INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES (
  'post-images',
  'post-images',
  true,
  5242880, -- 5MB limit
  ARRAY['image/jpeg', 'image/jpg', 'image/png', 'image/gif', 'image/webp']
);

-- RLS policies for post-images bucket
CREATE POLICY "Anyone can view post images"
ON storage.objects
FOR SELECT
USING (bucket_id = 'post-images');

CREATE POLICY "Authenticated users can upload post images"
ON storage.objects
FOR INSERT
WITH CHECK (
  bucket_id = 'post-images' 
  AND auth.role() = 'authenticated'
);

CREATE POLICY "Users can delete their own post images"
ON storage.objects
FOR DELETE
USING (
  bucket_id = 'post-images' 
  AND auth.uid()::text = (storage.foldername(name))[1]
);

-- Migration: 20251103121249
-- Create a security definer function to get user's nostr_hex_id
CREATE OR REPLACE FUNCTION public.get_user_nostr_hex_id(user_id UUID)
RETURNS TEXT
LANGUAGE SQL
SECURITY DEFINER
SET search_path = public
STABLE
AS $$
  SELECT nostr_hex_id::TEXT 
  FROM admin_users 
  WHERE user_id = $1
  LIMIT 1;
$$;

-- Drop existing policies for post-images bucket
DROP POLICY IF EXISTS "Anyone can view post images" ON storage.objects;
DROP POLICY IF EXISTS "Authenticated users can upload post images" ON storage.objects;
DROP POLICY IF EXISTS "Users can delete their own post images" ON storage.objects;

-- Recreate policies with correct nostr_hex_id check
CREATE POLICY "Anyone can view post images"
ON storage.objects
FOR SELECT
USING (bucket_id = 'post-images');

CREATE POLICY "Authenticated users can upload post images"
ON storage.objects
FOR INSERT
TO authenticated
WITH CHECK (
  bucket_id = 'post-images' 
  AND (storage.foldername(name))[1] = public.get_user_nostr_hex_id(auth.uid())
);

CREATE POLICY "Users can delete their own post images"
ON storage.objects
FOR DELETE
TO authenticated
USING (
  bucket_id = 'post-images' 
  AND (storage.foldername(name))[1] = public.get_user_nostr_hex_id(auth.uid())
);

-- Migration: 20251103121822
-- Drop all existing post-images policies explicitly
DO $$ 
BEGIN
    DROP POLICY IF EXISTS "Anyone can view post images" ON storage.objects;
    DROP POLICY IF EXISTS "Authenticated users can upload post images" ON storage.objects;
    DROP POLICY IF EXISTS "Authenticated users can delete post images" ON storage.objects;
    DROP POLICY IF EXISTS "Users can delete their own post images" ON storage.objects;
EXCEPTION 
    WHEN OTHERS THEN 
        NULL; -- Ignore errors if policies don't exist
END $$;

-- Create new simplified policies
CREATE POLICY "Anyone can view post images"
ON storage.objects
FOR SELECT
USING (bucket_id = 'post-images');

CREATE POLICY "Authenticated users can upload post images"
ON storage.objects
FOR INSERT
TO authenticated
WITH CHECK (bucket_id = 'post-images');

CREATE POLICY "Authenticated users can delete post images"
ON storage.objects
FOR DELETE
TO authenticated
USING (bucket_id = 'post-images');

-- Migration: 20251103123139
-- Drop all existing post-images policies
DROP POLICY IF EXISTS "Anyone can view post images" ON storage.objects;
DROP POLICY IF EXISTS "Authenticated users can upload post images" ON storage.objects;
DROP POLICY IF EXISTS "Authenticated users can delete post images" ON storage.objects;
DROP POLICY IF EXISTS "Users can delete their own post images" ON storage.objects;

-- Create public policies that work WITHOUT Supabase Auth
-- These policies apply to ALL roles (public, anon, authenticated)

CREATE POLICY "Public can view post images"
ON storage.objects
FOR SELECT
USING (bucket_id = 'post-images');

CREATE POLICY "Public can upload post images"
ON storage.objects
FOR INSERT
WITH CHECK (bucket_id = 'post-images');

CREATE POLICY "Public can delete post images"
ON storage.objects
FOR DELETE
USING (bucket_id = 'post-images');

-- Migration: 20251104110227
-- Table for UTXO locking system (prevents double-spending)
CREATE TABLE IF NOT EXISTS public.utxo_locks (
  outpoint TEXT PRIMARY KEY,
  locked_by TEXT NOT NULL,
  locked_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  expires_at TIMESTAMPTZ NOT NULL DEFAULT (now() + INTERVAL '10 minutes')
);

CREATE INDEX IF NOT EXISTS idx_utxo_locks_expires_at ON public.utxo_locks(expires_at);

COMMENT ON TABLE public.utxo_locks IS 'Locks UTXOs to prevent double-spending in concurrent batch payments';

-- Table for tracking batch payment progress
CREATE TABLE IF NOT EXISTS public.payment_batches (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  sender_pubkey TEXT NOT NULL,
  total_recipients INTEGER NOT NULL,
  successful_count INTEGER NOT NULL DEFAULT 0,
  failed_count INTEGER NOT NULL DEFAULT 0,
  status TEXT NOT NULL DEFAULT 'processing',
  results JSONB,
  estimated_time_seconds INTEGER,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_payment_batches_sender ON public.payment_batches(sender_pubkey);
CREATE INDEX IF NOT EXISTS idx_payment_batches_status ON public.payment_batches(status);
CREATE INDEX IF NOT EXISTS idx_payment_batches_created_at ON public.payment_batches(created_at DESC);

COMMENT ON TABLE public.payment_batches IS 'Tracks batch LASH payment progress and results';

-- Table for storing failed Nostr relay broadcasts
CREATE TABLE IF NOT EXISTS public.failed_relay_events (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  event_id TEXT NOT NULL,
  event_kind INTEGER NOT NULL,
  event_content JSONB NOT NULL,
  relay_urls TEXT[],
  error_message TEXT,
  retry_count INTEGER NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  last_retry_at TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS idx_failed_relay_events_event_id ON public.failed_relay_events(event_id);
CREATE INDEX IF NOT EXISTS idx_failed_relay_events_created_at ON public.failed_relay_events(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_failed_relay_events_retry_count ON public.failed_relay_events(retry_count);

COMMENT ON TABLE public.failed_relay_events IS 'Stores Nostr events that failed to broadcast to relays for later retry';

-- Function to cleanup expired UTXO locks
CREATE OR REPLACE FUNCTION public.cleanup_expired_utxo_locks()
RETURNS INTEGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  deleted_count INTEGER;
BEGIN
  DELETE FROM public.utxo_locks
  WHERE expires_at < now();
  
  GET DIAGNOSTICS deleted_count = ROW_COUNT;
  RETURN deleted_count;
END;
$$;

COMMENT ON FUNCTION public.cleanup_expired_utxo_locks IS 'Removes expired UTXO locks from the database';

-- Enable RLS on all tables
ALTER TABLE public.utxo_locks ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.payment_batches ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.failed_relay_events ENABLE ROW LEVEL SECURITY;

-- RLS policies for utxo_locks (edge functions need access)
CREATE POLICY "Edge functions can manage UTXO locks"
ON public.utxo_locks
FOR ALL
TO service_role
USING (true)
WITH CHECK (true);

-- RLS policies for payment_batches
CREATE POLICY "Users can view their own batches"
ON public.payment_batches
FOR SELECT
USING (true);

CREATE POLICY "Edge functions can manage batches"
ON public.payment_batches
FOR ALL
TO service_role
USING (true)
WITH CHECK (true);

-- RLS policies for failed_relay_events
CREATE POLICY "Edge functions can manage failed events"
ON public.failed_relay_events
FOR ALL
TO service_role
USING (true)
WITH CHECK (true);

-- Trigger to update updated_at on payment_batches
CREATE OR REPLACE FUNCTION public.update_payment_batch_timestamp()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$;

CREATE TRIGGER update_payment_batches_updated_at
BEFORE UPDATE ON public.payment_batches
FOR EACH ROW
EXECUTE FUNCTION public.update_payment_batch_timestamp();

-- Migration: 20251104110304
-- Fix search_path for update_payment_batch_timestamp function
DROP FUNCTION IF EXISTS public.update_payment_batch_timestamp() CASCADE;

CREATE OR REPLACE FUNCTION public.update_payment_batch_timestamp()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$;

-- Recreate trigger
CREATE TRIGGER update_payment_batches_updated_at
BEFORE UPDATE ON public.payment_batches
FOR EACH ROW
EXECUTE FUNCTION public.update_payment_batch_timestamp();

-- Migration: 20251107165013
-- Create transaction history table for tracking sent transactions
CREATE TABLE IF NOT EXISTS public.transaction_history (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  txid text NOT NULL,
  sender_pubkey text NOT NULL,
  block_height integer NOT NULL,
  block_time integer NOT NULL,
  used_utxos text[] NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

-- Index for fast lookup by sender and block
CREATE INDEX IF NOT EXISTS idx_transaction_history_sender_block 
  ON public.transaction_history(sender_pubkey, block_height DESC);

-- Index for TXID lookup
CREATE INDEX IF NOT EXISTS idx_transaction_history_txid 
  ON public.transaction_history(txid);

-- RLS Policies
ALTER TABLE public.transaction_history ENABLE ROW LEVEL SECURITY;

-- Edge functions can manage transaction history
CREATE POLICY "Edge functions can manage transaction history"
  ON public.transaction_history
  FOR ALL
  USING (true)
  WITH CHECK (true);

-- Users can view their own transaction history
CREATE POLICY "Users can view their own transaction history"
  ON public.transaction_history
  FOR SELECT
  USING (true);

COMMENT ON TABLE public.transaction_history IS 'Tracks blockchain transactions to prevent UTXO reuse within the same block';
COMMENT ON COLUMN public.transaction_history.used_utxos IS 'Array of outpoints in format "txhash:vout" used in this transaction';

-- Migration: 20251108171938
-- Create dm-audio bucket for audio direct messages
INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES (
  'dm-audio',
  'dm-audio',
  true,
  10485760,  -- 10MB limit
  ARRAY['audio/webm', 'audio/mp4', 'audio/m4a', 'audio/aac', 'audio/mpeg', 'audio/mp3', 'audio/wav', 'audio/ogg']
);

-- RLS Policy: Users can upload their own audio files
CREATE POLICY "Users can upload their own audio"
ON storage.objects FOR INSERT
WITH CHECK (
  bucket_id = 'dm-audio' AND
  auth.uid() IS NOT NULL
);

-- RLS Policy: Users can delete their own audio files
CREATE POLICY "Users can delete their own audio"
ON storage.objects FOR DELETE
USING (
  bucket_id = 'dm-audio' AND
  auth.uid() IS NOT NULL
);

-- RLS Policy: Audio files are publicly accessible for reading
CREATE POLICY "Audio files are publicly accessible"
ON storage.objects FOR SELECT
USING (bucket_id = 'dm-audio');

-- Migration: 20251108172643
-- Drop existing restrictive policies
DROP POLICY IF EXISTS "Users can upload their own audio" ON storage.objects;
DROP POLICY IF EXISTS "Users can delete their own audio" ON storage.objects;

-- Create new policies that work without Supabase Auth
-- Allow anyone to upload to dm-audio bucket (files are organized by Nostr IDs)
CREATE POLICY "Anyone can upload to dm-audio"
ON storage.objects FOR INSERT
WITH CHECK (bucket_id = 'dm-audio');

-- Allow anyone to delete from dm-audio bucket
CREATE POLICY "Anyone can delete from dm-audio"
ON storage.objects FOR DELETE
USING (bucket_id = 'dm-audio');

-- Keep the public read policy
CREATE POLICY "dm-audio files are publicly readable"
ON storage.objects FOR SELECT
USING (bucket_id = 'dm-audio');

-- Migration: 20251108174709
-- Create dm-images bucket for storing DM images (auto-deleted after 30 days)
INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types) 
VALUES (
  'dm-images', 
  'dm-images', 
  true, 
  5242880, -- 5MB limit
  ARRAY['image/jpeg', 'image/jpg', 'image/png', 'image/gif', 'image/webp']
);

-- RLS policies for dm-images bucket
CREATE POLICY "Anyone can view dm-images" 
ON storage.objects 
FOR SELECT 
USING (bucket_id = 'dm-images');

CREATE POLICY "Anyone can insert dm-images" 
ON storage.objects 
FOR INSERT 
WITH CHECK (bucket_id = 'dm-images');

CREATE POLICY "Anyone can delete dm-images" 
ON storage.objects 
FOR DELETE 
USING (bucket_id = 'dm-images');

-- Migration: 20251109065553
/*
 * CLEANUP: Removed unused tables from initial batch payment design
 * 
 * Removed tables:
 * - failed_relay_events: Nostr relay retry system never implemented
 * - payment_batches: Batch status tracking not used (results returned directly)
 * - utxo_locks: UTXO locking not needed (edge functions run sequentially)
 * - user_roles: Replaced by admin_users table for admin identification
 * 
 * Kept tables:
 * - transaction_history: Used for block-based UTXO reuse protection
 * - admin_users: Used for admin authentication via nostr_hex_id
 * - dm_read_status: Used for DM read status tracking
 * - app_settings: Used for application settings
 * - wallet_types: Used for wallet type configuration
 */

-- Drop unused tables
DROP TABLE IF EXISTS public.failed_relay_events CASCADE;
DROP TABLE IF EXISTS public.payment_batches CASCADE;
DROP TABLE IF EXISTS public.utxo_locks CASCADE;
DROP TABLE IF EXISTS public.user_roles CASCADE;

-- Drop unused functions
DROP FUNCTION IF EXISTS public.cleanup_expired_utxo_locks() CASCADE;
DROP FUNCTION IF EXISTS public.update_payment_batch_timestamp() CASCADE;
DROP FUNCTION IF EXISTS public.has_role(uuid, app_role) CASCADE;

-- Drop unused enum
DROP TYPE IF EXISTS public.app_role CASCADE;

-- Migration: 20251109070814
-- Enable pg_cron extension for scheduling
CREATE EXTENSION IF NOT EXISTS pg_cron WITH SCHEMA extensions;

-- Enable pg_net extension for HTTP requests
CREATE EXTENSION IF NOT EXISTS pg_net WITH SCHEMA extensions;

-- Migration: 20251109091747
-- Create nostr_profiles table for caching
CREATE TABLE public.nostr_profiles (
  nostr_hex_id TEXT PRIMARY KEY,
  full_name TEXT,
  display_name TEXT,
  picture TEXT,
  about TEXT,
  lana_wallet_id TEXT,
  raw_metadata JSONB,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  last_fetched_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Indexes for fast lookups
CREATE INDEX idx_nostr_profiles_display_name ON public.nostr_profiles(display_name);
CREATE INDEX idx_nostr_profiles_full_name ON public.nostr_profiles(full_name);
CREATE INDEX idx_nostr_profiles_last_fetched ON public.nostr_profiles(last_fetched_at);

-- Enable RLS
ALTER TABLE public.nostr_profiles ENABLE ROW LEVEL SECURITY;

-- Anyone can read profiles (Nostr profiles are public)
CREATE POLICY "Anyone can read nostr profiles"
  ON public.nostr_profiles
  FOR SELECT
  USING (true);

-- Only service role can insert/update (edge functions)
CREATE POLICY "Service role can manage nostr profiles"
  ON public.nostr_profiles
  FOR ALL
  USING (auth.role() = 'service_role');

-- Trigger for updated_at
CREATE TRIGGER update_nostr_profiles_updated_at
  BEFORE UPDATE ON public.nostr_profiles
  FOR EACH ROW
  EXECUTE FUNCTION public.update_updated_at_column();

-- Migration: 20251109095334
-- Allow anyone to insert/update nostr profiles (public data from relays)
CREATE POLICY "Anyone can upsert nostr profiles"
ON public.nostr_profiles
FOR ALL
USING (true)
WITH CHECK (true);

-- Migration: 20251109102826
-- Create direct_messages table for local caching
CREATE TABLE public.direct_messages (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  event_id text UNIQUE NOT NULL,
  sender_pubkey text NOT NULL,
  recipient_pubkey text NOT NULL,
  content text NOT NULL,
  decrypted_content text,
  created_at timestamptz NOT NULL,
  received_at timestamptz DEFAULT now(),
  kind integer DEFAULT 4,
  tags jsonb DEFAULT '[]'::jsonb,
  raw_event jsonb
);

-- Performance indexes for fast queries
CREATE INDEX idx_dm_conversation_time 
  ON public.direct_messages(
    LEAST(sender_pubkey, recipient_pubkey),
    GREATEST(sender_pubkey, recipient_pubkey),
    created_at DESC
  );

CREATE INDEX idx_dm_sender_time 
  ON public.direct_messages(sender_pubkey, created_at DESC);

CREATE INDEX idx_dm_recipient_time 
  ON public.direct_messages(recipient_pubkey, created_at DESC);

CREATE INDEX idx_dm_event_id 
  ON public.direct_messages(event_id);

CREATE INDEX idx_dm_created_at 
  ON public.direct_messages(created_at DESC);

-- Enable RLS
ALTER TABLE public.direct_messages ENABLE ROW LEVEL SECURITY;

-- RLS Policies
CREATE POLICY "Users can view messages"
  ON public.direct_messages
  FOR SELECT
  USING (true);

CREATE POLICY "Users can insert messages"
  ON public.direct_messages
  FOR INSERT
  WITH CHECK (true);

CREATE POLICY "Users can update messages"
  ON public.direct_messages
  FOR UPDATE
  USING (true)
  WITH CHECK (true);

-- Cleanup function: Keep last 20 messages, delete old ones only if > 20 messages
CREATE OR REPLACE FUNCTION cleanup_old_direct_messages()
RETURNS integer AS $$
DECLARE
  deleted_count integer;
BEGIN
  WITH ranked_messages AS (
    SELECT 
      id,
      created_at,
      ROW_NUMBER() OVER (
        PARTITION BY 
          LEAST(sender_pubkey, recipient_pubkey),
          GREATEST(sender_pubkey, recipient_pubkey)
        ORDER BY created_at DESC
      ) as rn
    FROM public.direct_messages
  )
  DELETE FROM public.direct_messages
  WHERE id IN (
    SELECT id FROM ranked_messages 
    WHERE rn > 20 AND created_at < NOW() - INTERVAL '30 days'
  );
  
  GET DIAGNOSTICS deleted_count = ROW_COUNT;
  
  RETURN deleted_count;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Migration: 20251109102926
-- Fix search path security warning for cleanup function
CREATE OR REPLACE FUNCTION cleanup_old_direct_messages()
RETURNS integer AS $$
DECLARE
  deleted_count integer;
BEGIN
  WITH ranked_messages AS (
    SELECT 
      id,
      created_at,
      ROW_NUMBER() OVER (
        PARTITION BY 
          LEAST(sender_pubkey, recipient_pubkey),
          GREATEST(sender_pubkey, recipient_pubkey)
        ORDER BY created_at DESC
      ) as rn
    FROM public.direct_messages
  )
  DELETE FROM public.direct_messages
  WHERE id IN (
    SELECT id FROM ranked_messages 
    WHERE rn > 20 AND created_at < NOW() - INTERVAL '30 days'
  );
  
  GET DIAGNOSTICS deleted_count = ROW_COUNT;
  
  RETURN deleted_count;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;

-- Migration: 20251111073641
-- Remove the temporary public update policy
DROP POLICY IF EXISTS "Temporary public update for app settings" ON public.app_settings;

-- Add a policy that only allows service role to update app_settings
-- This ensures updates can only happen through the edge function which validates admin status
CREATE POLICY "Only service role can update app settings"
ON public.app_settings
FOR UPDATE
TO service_role
USING (true)
WITH CHECK (true);

-- Migration: 20251111202317
-- Enable Supabase Realtime for instant chat updates
-- This allows real-time subscriptions to direct messages and read status changes

-- Enable realtime for direct_messages table
ALTER PUBLICATION supabase_realtime ADD TABLE public.direct_messages;

-- Enable realtime for dm_read_status table  
ALTER PUBLICATION supabase_realtime ADD TABLE public.dm_read_status;
