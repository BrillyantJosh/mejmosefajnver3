CREATE EXTENSION IF NOT EXISTS "pg_cron" WITH SCHEMA "pg_catalog";
CREATE EXTENSION IF NOT EXISTS "pg_graphql" WITH SCHEMA "graphql";
CREATE EXTENSION IF NOT EXISTS "pg_net" WITH SCHEMA "extensions";
CREATE EXTENSION IF NOT EXISTS "pg_stat_statements" WITH SCHEMA "extensions";
CREATE EXTENSION IF NOT EXISTS "pgcrypto" WITH SCHEMA "extensions";
CREATE EXTENSION IF NOT EXISTS "plpgsql" WITH SCHEMA "pg_catalog";
CREATE EXTENSION IF NOT EXISTS "supabase_vault" WITH SCHEMA "vault";
CREATE EXTENSION IF NOT EXISTS "uuid-ossp" WITH SCHEMA "extensions";
--
-- PostgreSQL database dump
--


-- Dumped from database version 17.6
-- Dumped by pg_dump version 18.1

SET statement_timeout = 0;
SET lock_timeout = 0;
SET idle_in_transaction_session_timeout = 0;
SET transaction_timeout = 0;
SET client_encoding = 'UTF8';
SET standard_conforming_strings = on;
SELECT pg_catalog.set_config('search_path', '', false);
SET check_function_bodies = false;
SET xmloption = content;
SET client_min_messages = warning;
SET row_security = off;

--
-- Name: public; Type: SCHEMA; Schema: -; Owner: -
--



--
-- Name: cleanup_old_direct_messages(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.cleanup_old_direct_messages() RETURNS integer
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
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
$$;


--
-- Name: get_user_nostr_hex_id(uuid); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.get_user_nostr_hex_id(user_id uuid) RETURNS text
    LANGUAGE sql STABLE SECURITY DEFINER
    SET search_path TO 'public'
    AS $_$
  SELECT nostr_hex_id::TEXT 
  FROM admin_users 
  WHERE user_id = $1
  LIMIT 1;
$_$;


--
-- Name: update_updated_at_column(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.update_updated_at_column() RETURNS trigger
    LANGUAGE plpgsql
    SET search_path TO 'public'
    AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$;


SET default_table_access_method = heap;

--
-- Name: admin_users; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.admin_users (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    nostr_hex_id text NOT NULL,
    created_at timestamp with time zone DEFAULT now(),
    updated_at timestamp with time zone DEFAULT now(),
    last_seen_at timestamp with time zone
);


--
-- Name: app_settings; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.app_settings (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    key text NOT NULL,
    value jsonb NOT NULL,
    updated_at timestamp with time zone DEFAULT now(),
    updated_by uuid
);


--
-- Name: direct_messages; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.direct_messages (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    event_id text NOT NULL,
    sender_pubkey text NOT NULL,
    recipient_pubkey text NOT NULL,
    content text NOT NULL,
    decrypted_content text,
    created_at timestamp with time zone NOT NULL,
    received_at timestamp with time zone DEFAULT now(),
    kind integer DEFAULT 4,
    tags jsonb DEFAULT '[]'::jsonb,
    raw_event jsonb
);


--
-- Name: dm_lashes; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.dm_lashes (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    message_event_id text NOT NULL,
    lash_event_id text NOT NULL,
    sender_pubkey text NOT NULL,
    recipient_pubkey text NOT NULL,
    amount text NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    expires_at timestamp with time zone
);


--
-- Name: dm_read_status; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.dm_read_status (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    user_nostr_id text NOT NULL,
    message_event_id text NOT NULL,
    sender_pubkey text NOT NULL,
    conversation_pubkey text NOT NULL,
    is_read boolean DEFAULT false NOT NULL,
    read_at timestamp with time zone,
    created_at timestamp with time zone DEFAULT now(),
    updated_at timestamp with time zone DEFAULT now()
);


--
-- Name: kind_38888; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.kind_38888 (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    event_id text NOT NULL,
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


--
-- Name: lash_users_history; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.lash_users_history (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    event_id text NOT NULL,
    nostr_hex_id text NOT NULL,
    created_at timestamp with time zone DEFAULT now()
);


--
-- Name: nostr_profiles; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.nostr_profiles (
    nostr_hex_id text NOT NULL,
    full_name text,
    display_name text,
    picture text,
    about text,
    lana_wallet_id text,
    raw_metadata jsonb,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    last_fetched_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: transaction_history; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.transaction_history (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    txid text NOT NULL,
    sender_pubkey text NOT NULL,
    block_height integer NOT NULL,
    block_time integer NOT NULL,
    used_utxos text[] NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: wallet_types; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.wallet_types (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    name text NOT NULL,
    description text,
    is_active boolean DEFAULT true NOT NULL,
    display_order integer DEFAULT 0 NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: admin_users admin_users_nostr_hex_id_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.admin_users
    ADD CONSTRAINT admin_users_nostr_hex_id_key UNIQUE (nostr_hex_id);


--
-- Name: admin_users admin_users_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.admin_users
    ADD CONSTRAINT admin_users_pkey PRIMARY KEY (id);


--
-- Name: app_settings app_settings_key_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.app_settings
    ADD CONSTRAINT app_settings_key_key UNIQUE (key);


--
-- Name: app_settings app_settings_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.app_settings
    ADD CONSTRAINT app_settings_pkey PRIMARY KEY (id);


--
-- Name: direct_messages direct_messages_event_id_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.direct_messages
    ADD CONSTRAINT direct_messages_event_id_key UNIQUE (event_id);


--
-- Name: direct_messages direct_messages_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.direct_messages
    ADD CONSTRAINT direct_messages_pkey PRIMARY KEY (id);


--
-- Name: dm_lashes dm_lashes_lash_event_id_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.dm_lashes
    ADD CONSTRAINT dm_lashes_lash_event_id_key UNIQUE (lash_event_id);


--
-- Name: dm_lashes dm_lashes_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.dm_lashes
    ADD CONSTRAINT dm_lashes_pkey PRIMARY KEY (id);


--
-- Name: dm_read_status dm_read_status_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.dm_read_status
    ADD CONSTRAINT dm_read_status_pkey PRIMARY KEY (id);


--
-- Name: dm_read_status dm_read_status_user_nostr_id_message_event_id_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.dm_read_status
    ADD CONSTRAINT dm_read_status_user_nostr_id_message_event_id_key UNIQUE (user_nostr_id, message_event_id);


--
-- Name: kind_38888 kind_38888_event_id_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.kind_38888
    ADD CONSTRAINT kind_38888_event_id_key UNIQUE (event_id);


--
-- Name: kind_38888 kind_38888_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.kind_38888
    ADD CONSTRAINT kind_38888_pkey PRIMARY KEY (id);


--
-- Name: lash_users_history lash_users_history_event_id_nostr_hex_id_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.lash_users_history
    ADD CONSTRAINT lash_users_history_event_id_nostr_hex_id_key UNIQUE (event_id, nostr_hex_id);


--
-- Name: lash_users_history lash_users_history_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.lash_users_history
    ADD CONSTRAINT lash_users_history_pkey PRIMARY KEY (id);


--
-- Name: nostr_profiles nostr_profiles_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.nostr_profiles
    ADD CONSTRAINT nostr_profiles_pkey PRIMARY KEY (nostr_hex_id);


--
-- Name: transaction_history transaction_history_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.transaction_history
    ADD CONSTRAINT transaction_history_pkey PRIMARY KEY (id);


--
-- Name: wallet_types wallet_types_name_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.wallet_types
    ADD CONSTRAINT wallet_types_name_key UNIQUE (name);


--
-- Name: wallet_types wallet_types_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.wallet_types
    ADD CONSTRAINT wallet_types_pkey PRIMARY KEY (id);


--
-- Name: idx_dm_conversation_time; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_dm_conversation_time ON public.direct_messages USING btree (LEAST(sender_pubkey, recipient_pubkey), GREATEST(sender_pubkey, recipient_pubkey), created_at DESC);


--
-- Name: idx_dm_created_at; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_dm_created_at ON public.direct_messages USING btree (created_at DESC);


--
-- Name: idx_dm_event_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_dm_event_id ON public.direct_messages USING btree (event_id);


--
-- Name: idx_dm_lashes_created; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_dm_lashes_created ON public.dm_lashes USING btree (created_at DESC);


--
-- Name: idx_dm_lashes_message; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_dm_lashes_message ON public.dm_lashes USING btree (message_event_id);


--
-- Name: idx_dm_lashes_sender; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_dm_lashes_sender ON public.dm_lashes USING btree (sender_pubkey);


--
-- Name: idx_dm_read_status_conversation_unread; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_dm_read_status_conversation_unread ON public.dm_read_status USING btree (user_nostr_id, conversation_pubkey, is_read);


--
-- Name: idx_dm_read_status_sender; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_dm_read_status_sender ON public.dm_read_status USING btree (sender_pubkey);


--
-- Name: idx_dm_read_status_user; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_dm_read_status_user ON public.dm_read_status USING btree (user_nostr_id);


--
-- Name: idx_dm_recipient_time; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_dm_recipient_time ON public.direct_messages USING btree (recipient_pubkey, created_at DESC);


--
-- Name: idx_dm_sender_time; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_dm_sender_time ON public.direct_messages USING btree (sender_pubkey, created_at DESC);


--
-- Name: idx_kind_38888_created_at; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_kind_38888_created_at ON public.kind_38888 USING btree (created_at DESC);


--
-- Name: idx_lash_users_history_event_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_lash_users_history_event_id ON public.lash_users_history USING btree (event_id);


--
-- Name: idx_lash_users_history_nostr_hex_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_lash_users_history_nostr_hex_id ON public.lash_users_history USING btree (nostr_hex_id);


--
-- Name: idx_nostr_profiles_display_name; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_nostr_profiles_display_name ON public.nostr_profiles USING btree (display_name);


--
-- Name: idx_nostr_profiles_full_name; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_nostr_profiles_full_name ON public.nostr_profiles USING btree (full_name);


--
-- Name: idx_nostr_profiles_last_fetched; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_nostr_profiles_last_fetched ON public.nostr_profiles USING btree (last_fetched_at);


--
-- Name: idx_transaction_history_sender_block; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_transaction_history_sender_block ON public.transaction_history USING btree (sender_pubkey, block_height DESC);


--
-- Name: idx_transaction_history_txid; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_transaction_history_txid ON public.transaction_history USING btree (txid);


--
-- Name: admin_users update_admin_users_updated_at; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER update_admin_users_updated_at BEFORE UPDATE ON public.admin_users FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();


--
-- Name: app_settings update_app_settings_updated_at; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER update_app_settings_updated_at BEFORE UPDATE ON public.app_settings FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();


--
-- Name: dm_read_status update_dm_read_status_updated_at; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER update_dm_read_status_updated_at BEFORE UPDATE ON public.dm_read_status FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();


--
-- Name: nostr_profiles update_nostr_profiles_updated_at; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER update_nostr_profiles_updated_at BEFORE UPDATE ON public.nostr_profiles FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();


--
-- Name: app_settings app_settings_updated_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.app_settings
    ADD CONSTRAINT app_settings_updated_by_fkey FOREIGN KEY (updated_by) REFERENCES auth.users(id);


--
-- Name: lash_users_history Anyone can insert lash; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Anyone can insert lash" ON public.lash_users_history FOR INSERT WITH CHECK (true);


--
-- Name: app_settings Anyone can read app settings; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Anyone can read app settings" ON public.app_settings FOR SELECT USING (true);


--
-- Name: lash_users_history Anyone can read lash history; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Anyone can read lash history" ON public.lash_users_history FOR SELECT USING (true);


--
-- Name: nostr_profiles Anyone can read nostr profiles; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Anyone can read nostr profiles" ON public.nostr_profiles FOR SELECT USING (true);


--
-- Name: kind_38888 Anyone can read system parameters; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Anyone can read system parameters" ON public.kind_38888 FOR SELECT USING (true);


--
-- Name: wallet_types Anyone can read wallet types; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Anyone can read wallet types" ON public.wallet_types FOR SELECT USING ((is_active = true));


--
-- Name: nostr_profiles Anyone can upsert nostr profiles; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Anyone can upsert nostr profiles" ON public.nostr_profiles USING (true) WITH CHECK (true);


--
-- Name: admin_users Anyone can view admin users; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Anyone can view admin users" ON public.admin_users FOR SELECT USING (true);


--
-- Name: transaction_history Edge functions can manage transaction history; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Edge functions can manage transaction history" ON public.transaction_history USING (true) WITH CHECK (true);


--
-- Name: app_settings Only service role can update app settings; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Only service role can update app settings" ON public.app_settings FOR UPDATE TO service_role USING (true) WITH CHECK (true);


--
-- Name: nostr_profiles Service role can manage nostr profiles; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Service role can manage nostr profiles" ON public.nostr_profiles USING ((auth.role() = 'service_role'::text));


--
-- Name: kind_38888 Service role can manage system parameters; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Service role can manage system parameters" ON public.kind_38888 USING (true) WITH CHECK (true);


--
-- Name: dm_read_status Users can delete read status; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Users can delete read status" ON public.dm_read_status FOR DELETE USING (true);


--
-- Name: dm_lashes Users can insert lashes; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Users can insert lashes" ON public.dm_lashes FOR INSERT WITH CHECK (true);


--
-- Name: direct_messages Users can insert messages; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Users can insert messages" ON public.direct_messages FOR INSERT WITH CHECK (true);


--
-- Name: dm_read_status Users can insert read status; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Users can insert read status" ON public.dm_read_status FOR INSERT WITH CHECK (true);


--
-- Name: direct_messages Users can update messages; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Users can update messages" ON public.direct_messages FOR UPDATE USING (true) WITH CHECK (true);


--
-- Name: dm_read_status Users can update read status; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Users can update read status" ON public.dm_read_status FOR UPDATE USING (true) WITH CHECK (true);


--
-- Name: dm_lashes Users can view all lashes; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Users can view all lashes" ON public.dm_lashes FOR SELECT USING (true);


--
-- Name: dm_read_status Users can view all read status; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Users can view all read status" ON public.dm_read_status FOR SELECT USING (true);


--
-- Name: direct_messages Users can view messages; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Users can view messages" ON public.direct_messages FOR SELECT USING (true);


--
-- Name: transaction_history Users can view their own transaction history; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Users can view their own transaction history" ON public.transaction_history FOR SELECT USING (true);


--
-- Name: admin_users; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.admin_users ENABLE ROW LEVEL SECURITY;

--
-- Name: app_settings; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.app_settings ENABLE ROW LEVEL SECURITY;

--
-- Name: direct_messages; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.direct_messages ENABLE ROW LEVEL SECURITY;

--
-- Name: dm_lashes; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.dm_lashes ENABLE ROW LEVEL SECURITY;

--
-- Name: dm_read_status; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.dm_read_status ENABLE ROW LEVEL SECURITY;

--
-- Name: kind_38888; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.kind_38888 ENABLE ROW LEVEL SECURITY;

--
-- Name: lash_users_history; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.lash_users_history ENABLE ROW LEVEL SECURITY;

--
-- Name: nostr_profiles; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.nostr_profiles ENABLE ROW LEVEL SECURITY;

--
-- Name: transaction_history; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.transaction_history ENABLE ROW LEVEL SECURITY;

--
-- Name: wallet_types; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.wallet_types ENABLE ROW LEVEL SECURITY;

--
-- PostgreSQL database dump complete
--


