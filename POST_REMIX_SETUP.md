# Post-Remix Setup Guide

> **IMPORTANT**: After remixing the project, you MUST configure CRON jobs AND Storage RLS policies!

This document contains all necessary SQL commands to configure the project after a remix.

---

# Table of Contents

1. [Prerequisites](#1-prerequisites)
2. [CRON Jobs Setup](#2-cron-jobs-setup)
3. [Storage RLS Policies](#3-storage-rls-policies)
4. [Verification Commands](#4-verification-commands)
5. [Cleanup Commands](#5-cleanup-commands)
6. [Post-Remix Checklist](#6-post-remix-checklist)

---

# 1. Prerequisites

Before configuring CRON jobs, you need to enable the `pg_cron` and `pg_net` extensions.

```sql
-- Enable extensions (run once)
CREATE EXTENSION IF NOT EXISTS pg_cron;
CREATE EXTENSION IF NOT EXISTS pg_net;
```

---

# 2. CRON Jobs Setup

## 2.1 Overview

| Function | Purpose | Interval | CRON Expression |
|----------|---------|----------|-----------------|
| `cleanup-direct-messages` | Deletes old direct messages (>30 days, >20 per conversation) | Daily at 03:00 | `0 3 * * *` |
| `cleanup-dm-audio` | Deletes old audio files from DMs | Daily at 03:15 | `15 3 * * *` |
| `cleanup-dm-images` | Deletes old images from DMs | Daily at 03:30 | `30 3 * * *` |
| `delete-old-post-images` | Deletes old post images | Daily at 03:45 | `45 3 * * *` |
| `refresh-nostr-profiles` | Refreshes stale Nostr profiles | Every 15 minutes | `*/15 * * * *` |
| `sync-kind-38888` | Synchronizes KIND 38888 events | Every 5 minutes | `*/5 * * * *` |

## 2.2 SQL Prompt for CRON Setup

> ⚠️ **IMPORTANT**: Replace `YOUR_PROJECT_REF` and `YOUR_ANON_KEY` with actual values from your new project!

```sql
-- ============================================
-- CRON SETUP - Copy and run in SQL Editor
-- ============================================

-- 1. cleanup-direct-messages (daily at 03:00 UTC)
SELECT cron.schedule(
  'cleanup-direct-messages',
  '0 3 * * *',
  $$
  SELECT net.http_post(
    url := 'https://YOUR_PROJECT_REF.supabase.co/functions/v1/cleanup-direct-messages',
    headers := '{"Content-Type": "application/json", "Authorization": "Bearer YOUR_ANON_KEY"}'::jsonb,
    body := '{}'::jsonb
  ) AS request_id;
  $$
);

-- 2. cleanup-dm-audio (daily at 03:15 UTC)
SELECT cron.schedule(
  'cleanup-dm-audio',
  '15 3 * * *',
  $$
  SELECT net.http_post(
    url := 'https://YOUR_PROJECT_REF.supabase.co/functions/v1/cleanup-dm-audio',
    headers := '{"Content-Type": "application/json", "Authorization": "Bearer YOUR_ANON_KEY"}'::jsonb,
    body := '{}'::jsonb
  ) AS request_id;
  $$
);

-- 3. cleanup-dm-images (daily at 03:30 UTC)
SELECT cron.schedule(
  'cleanup-dm-images',
  '30 3 * * *',
  $$
  SELECT net.http_post(
    url := 'https://YOUR_PROJECT_REF.supabase.co/functions/v1/cleanup-dm-images',
    headers := '{"Content-Type": "application/json", "Authorization": "Bearer YOUR_ANON_KEY"}'::jsonb,
    body := '{}'::jsonb
  ) AS request_id;
  $$
);

-- 4. delete-old-post-images (daily at 03:45 UTC)
SELECT cron.schedule(
  'delete-old-post-images',
  '45 3 * * *',
  $$
  SELECT net.http_post(
    url := 'https://YOUR_PROJECT_REF.supabase.co/functions/v1/delete-old-post-images',
    headers := '{"Content-Type": "application/json", "Authorization": "Bearer YOUR_ANON_KEY"}'::jsonb,
    body := '{}'::jsonb
  ) AS request_id;
  $$
);

-- 5. refresh-nostr-profiles (every 15 minutes)
SELECT cron.schedule(
  'refresh-nostr-profiles',
  '*/15 * * * *',
  $$
  SELECT net.http_post(
    url := 'https://YOUR_PROJECT_REF.supabase.co/functions/v1/refresh-nostr-profiles?mode=stale',
    headers := '{"Content-Type": "application/json", "Authorization": "Bearer YOUR_ANON_KEY"}'::jsonb,
    body := '{}'::jsonb
  ) AS request_id;
  $$
);

-- 6. sync-kind-38888 (every 5 minutes)
SELECT cron.schedule(
  'sync-kind-38888',
  '*/5 * * * *',
  $$
  SELECT net.http_post(
    url := 'https://YOUR_PROJECT_REF.supabase.co/functions/v1/sync-kind-38888',
    headers := '{"Content-Type": "application/json", "Authorization": "Bearer YOUR_ANON_KEY"}'::jsonb,
    body := '{}'::jsonb
  ) AS request_id;
  $$
);
```

---

# 3. Storage RLS Policies

After remix, storage buckets exist but **do not have RLS policies** for uploading files. Without these policies, users cannot upload images or audio in DMs.

## 3.1 Storage Buckets Overview

| Bucket | Purpose | Public |
|--------|---------|--------|
| `dm-audio` | Audio messages in direct messages | Yes |
| `dm-images` | Image attachments in direct messages | Yes |
| `post-images` | Images for social posts | Yes |

## 3.2 SQL Prompt for Storage RLS Policies

```sql
-- ============================================
-- STORAGE RLS POLICIES - Copy and run in SQL Editor
-- ============================================

-- dm-audio bucket policies
CREATE POLICY "Anyone can upload dm audio"
ON storage.objects FOR INSERT
WITH CHECK (bucket_id = 'dm-audio');

CREATE POLICY "Anyone can view dm audio"
ON storage.objects FOR SELECT
USING (bucket_id = 'dm-audio');

CREATE POLICY "Anyone can delete dm audio"
ON storage.objects FOR DELETE
USING (bucket_id = 'dm-audio');

-- dm-images bucket policies
CREATE POLICY "Anyone can upload dm images"
ON storage.objects FOR INSERT
WITH CHECK (bucket_id = 'dm-images');

CREATE POLICY "Anyone can view dm images"
ON storage.objects FOR SELECT
USING (bucket_id = 'dm-images');

CREATE POLICY "Anyone can delete dm images"
ON storage.objects FOR DELETE
USING (bucket_id = 'dm-images');

-- post-images bucket policies
CREATE POLICY "Anyone can upload post images"
ON storage.objects FOR INSERT
WITH CHECK (bucket_id = 'post-images');

CREATE POLICY "Anyone can view post images"
ON storage.objects FOR SELECT
USING (bucket_id = 'post-images');

CREATE POLICY "Anyone can delete post images"
ON storage.objects FOR DELETE
USING (bucket_id = 'post-images');
```

---

# 4. Verification Commands

## 4.1 Verify CRON Jobs

```sql
-- Check all scheduled jobs
SELECT jobid, jobname, schedule, active 
FROM cron.job 
ORDER BY jobname;

-- Check execution history (last 20)
SELECT jobid, runid, job_pid, status, return_message, start_time, end_time
FROM cron.job_run_details 
ORDER BY start_time DESC 
LIMIT 20;
```

## 4.2 Verify Storage Policies

```sql
-- Check storage policies
SELECT policyname, tablename, cmd, qual, with_check 
FROM pg_policies 
WHERE schemaname = 'storage' 
ORDER BY tablename, policyname;
```

---

# 5. Cleanup Commands

## 5.1 Remove CRON Jobs

If you need to remove a scheduled job:

```sql
-- Remove individual jobs
SELECT cron.unschedule('cleanup-direct-messages');
SELECT cron.unschedule('cleanup-dm-audio');
SELECT cron.unschedule('cleanup-dm-images');
SELECT cron.unschedule('delete-old-post-images');
SELECT cron.unschedule('refresh-nostr-profiles');
SELECT cron.unschedule('sync-kind-38888');
```

## 5.2 Remove Storage Policies

If you need to remove storage policies:

```sql
-- Remove dm-audio policies
DROP POLICY IF EXISTS "Anyone can upload dm audio" ON storage.objects;
DROP POLICY IF EXISTS "Anyone can view dm audio" ON storage.objects;
DROP POLICY IF EXISTS "Anyone can delete dm audio" ON storage.objects;

-- Remove dm-images policies
DROP POLICY IF EXISTS "Anyone can upload dm images" ON storage.objects;
DROP POLICY IF EXISTS "Anyone can view dm images" ON storage.objects;
DROP POLICY IF EXISTS "Anyone can delete dm images" ON storage.objects;

-- Remove post-images policies
DROP POLICY IF EXISTS "Anyone can upload post images" ON storage.objects;
DROP POLICY IF EXISTS "Anyone can view post images" ON storage.objects;
DROP POLICY IF EXISTS "Anyone can delete post images" ON storage.objects;
```

---

# 6. Post-Remix Checklist

## Initial Setup
- [ ] Create new Supabase project
- [ ] Copy `PROJECT_REF` from project URL
- [ ] Copy `ANON_KEY` from Project Settings → API

## Extensions
- [ ] Enable `pg_cron` extension
- [ ] Enable `pg_net` extension

## CRON Jobs
- [ ] Run SQL to schedule all CRON jobs
- [ ] Verify jobs are active with `SELECT * FROM cron.job`

## Storage
- [ ] Run SQL to create Storage RLS policies for `dm-audio`
- [ ] Run SQL to create Storage RLS policies for `dm-images`
- [ ] Run SQL to create Storage RLS policies for `post-images`
- [ ] Test image upload in chat
- [ ] Test audio recording in chat

## Final Verification
- [ ] Test direct messaging functionality
- [ ] Test image attachments in DMs
- [ ] Test audio messages in DMs
- [ ] Test social post image uploads
