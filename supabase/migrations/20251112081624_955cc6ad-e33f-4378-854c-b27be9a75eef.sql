-- Trigger type regeneration by adding a comment
COMMENT ON TABLE public.admin_users IS 'Admin users with Nostr hex IDs';
COMMENT ON TABLE public.app_settings IS 'Application settings stored as key-value pairs';
COMMENT ON TABLE public.direct_messages IS 'Encrypted direct messages between users';
COMMENT ON TABLE public.dm_read_status IS 'Read status tracking for direct messages';
COMMENT ON TABLE public.nostr_profiles IS 'Cached Nostr profile metadata';
COMMENT ON TABLE public.transaction_history IS 'LANA transaction history';
COMMENT ON TABLE public.wallet_types IS 'Available wallet types for the system';

-- This migration does not change the schema structure,
-- but should trigger TypeScript type regeneration