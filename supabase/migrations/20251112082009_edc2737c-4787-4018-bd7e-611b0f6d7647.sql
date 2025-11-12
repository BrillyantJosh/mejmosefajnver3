-- Force complete type regeneration by adding a new column
ALTER TABLE public.admin_users 
ADD COLUMN IF NOT EXISTS last_seen_at TIMESTAMP WITH TIME ZONE DEFAULT NULL;

COMMENT ON COLUMN public.admin_users.last_seen_at IS 'Last time the admin was seen online';

-- This schema change should force TypeScript types to regenerate completely