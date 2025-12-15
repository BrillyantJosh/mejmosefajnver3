# Post-Remix Setup Guide

Po remixu projekta je potrebno ročno nastaviti CRON opravila v Supabase. Ta dokument vsebuje vse potrebne SQL ukaze.

---

## 1. Pregled CRON funkcij

| Funkcija | Namen | Interval | CRON izraz |
|----------|-------|----------|------------|
| `cleanup-direct-messages` | Briše stara direktna sporočila (>30 dni, >20 na pogovor) | Dnevno ob 03:00 | `0 3 * * *` |
| `cleanup-dm-audio` | Briše stare avdio datoteke iz DM | Dnevno ob 03:15 | `15 3 * * *` |
| `cleanup-dm-images` | Briše stare slike iz DM | Dnevno ob 03:30 | `30 3 * * *` |
| `delete-old-post-images` | Briše stare slike objav | Dnevno ob 03:45 | `45 3 * * *` |
| `refresh-nostr-profiles` | Osveži zastarele Nostr profile | Vsakih 15 minut | `*/15 * * * *` |
| `sync-kind-38888` | Sinhronizira KIND 38888 evente | Vsakih 5 minut | `*/5 * * * *` |

---

## 2. Predpogoji

Pred nastavitvijo CRON opravil je potrebno omogočiti razširitvi `pg_cron` in `pg_net`.

```sql
-- Omogoči razširitve (izvedi enkrat)
CREATE EXTENSION IF NOT EXISTS pg_cron;
CREATE EXTENSION IF NOT EXISTS pg_net;
```

---

## 3. SQL PROMPT za nastavitev vseh CRON opravil

> ⚠️ **POMEMBNO**: Zamenjaj `YOUR_PROJECT_REF` in `YOUR_ANON_KEY` z dejanskimi vrednostmi novega projekta!

```sql
-- ============================================
-- CRON SETUP - Kopiraj in zaženi v SQL Editorju
-- ============================================

-- 1. cleanup-direct-messages (dnevno ob 03:00 UTC)
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

-- 2. cleanup-dm-audio (dnevno ob 03:15 UTC)
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

-- 3. cleanup-dm-images (dnevno ob 03:30 UTC)
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

-- 4. delete-old-post-images (dnevno ob 03:45 UTC)
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

-- 5. refresh-nostr-profiles (vsakih 15 minut)
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

-- 6. sync-kind-38888 (vsakih 5 minut)
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

## 4. Preverjanje CRON opravil

```sql
-- Preveri vsa nastavljena opravila
SELECT jobid, jobname, schedule, active 
FROM cron.job 
ORDER BY jobname;

-- Preveri zgodovino izvajanj (zadnjih 20)
SELECT jobid, runid, job_pid, status, return_message, start_time, end_time
FROM cron.job_run_details 
ORDER BY start_time DESC 
LIMIT 20;
```

---

## 5. Brisanje CRON opravil

Če je potrebno odstraniti opravilo:

```sql
-- Odstrani posamezno opravilo
SELECT cron.unschedule('cleanup-direct-messages');
SELECT cron.unschedule('cleanup-dm-audio');
SELECT cron.unschedule('cleanup-dm-images');
SELECT cron.unschedule('delete-old-post-images');
SELECT cron.unschedule('refresh-nostr-profiles');
SELECT cron.unschedule('sync-kind-38888');
```

---

## 6. Checklist po remixu

- [ ] Ustvari nov Supabase projekt
- [ ] Kopiraj `PROJECT_REF` iz URL-ja projekta
- [ ] Kopiraj `ANON_KEY` iz Project Settings → API
- [ ] Omogoči `pg_cron` in `pg_net` razširitvi
- [ ] Zaženi SQL za nastavitev vseh CRON opravil
- [ ] Preveri, da so opravila aktivna z `SELECT * FROM cron.job`
