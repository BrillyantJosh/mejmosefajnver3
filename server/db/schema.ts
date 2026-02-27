import Database from 'better-sqlite3';

export function initializeSchema(db: Database.Database): void {
  db.exec(`
    -- =============================================
    -- TABLES
    -- =============================================

    CREATE TABLE IF NOT EXISTS admin_users (
      id TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(16)))),
      nostr_hex_id TEXT NOT NULL UNIQUE,
      created_at TEXT DEFAULT (datetime('now')),
      updated_at TEXT DEFAULT (datetime('now')),
      last_seen_at TEXT
    );

    CREATE TABLE IF NOT EXISTS ai_knowledge (
      id TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(16)))),
      slug TEXT NOT NULL,
      revision INTEGER NOT NULL DEFAULT 1,
      status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('draft','active','deprecated')),
      lang TEXT NOT NULL DEFAULT 'en',
      title TEXT NOT NULL,
      summary TEXT NOT NULL,
      body TEXT,
      topic TEXT CHECK (topic IN ('service','concept','rule','tech','faq')),
      keywords TEXT,
      nostr_event_id TEXT,
      created_by TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS ai_unsupported_prompts (
      id TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(16)))),
      nostr_hex_id TEXT NOT NULL,
      prompt TEXT NOT NULL,
      ai_response TEXT,
      context_summary TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS ai_usage_logs (
      id TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(16)))),
      nostr_hex_id TEXT NOT NULL,
      model TEXT NOT NULL,
      prompt_tokens INTEGER NOT NULL DEFAULT 0,
      completion_tokens INTEGER NOT NULL DEFAULT 0,
      total_tokens INTEGER NOT NULL DEFAULT 0,
      cost_usd REAL DEFAULT 0,
      cost_lana REAL DEFAULT 0,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS app_settings (
      id TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(16)))),
      key TEXT NOT NULL UNIQUE,
      value TEXT NOT NULL,
      updated_at TEXT DEFAULT (datetime('now')),
      updated_by TEXT
    );

    CREATE TABLE IF NOT EXISTS direct_messages (
      id TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(16)))),
      event_id TEXT NOT NULL UNIQUE,
      sender_pubkey TEXT NOT NULL,
      recipient_pubkey TEXT NOT NULL,
      content TEXT NOT NULL,
      decrypted_content TEXT,
      created_at TEXT NOT NULL,
      received_at TEXT DEFAULT (datetime('now')),
      kind INTEGER DEFAULT 4,
      tags TEXT DEFAULT '[]',
      raw_event TEXT
    );

    CREATE TABLE IF NOT EXISTS dm_lashes (
      id TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(16)))),
      message_event_id TEXT NOT NULL,
      lash_event_id TEXT NOT NULL UNIQUE,
      sender_pubkey TEXT NOT NULL,
      recipient_pubkey TEXT NOT NULL,
      amount TEXT NOT NULL,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      expires_at TEXT
    );

    CREATE TABLE IF NOT EXISTS dm_last_seen (
      nostr_hex_id TEXT PRIMARY KEY,
      last_event_created_at INTEGER NOT NULL DEFAULT 0,
      updated_at TEXT DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS dm_read_status (
      id TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(16)))),
      user_nostr_id TEXT NOT NULL,
      message_event_id TEXT NOT NULL,
      sender_pubkey TEXT NOT NULL,
      conversation_pubkey TEXT NOT NULL,
      is_read INTEGER NOT NULL DEFAULT 0,
      read_at TEXT,
      created_at TEXT DEFAULT (datetime('now')),
      updated_at TEXT DEFAULT (datetime('now')),
      UNIQUE(user_nostr_id, message_event_id)
    );

    CREATE TABLE IF NOT EXISTS kind_38888 (
      id TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(16)))),
      event_id TEXT NOT NULL UNIQUE,
      pubkey TEXT NOT NULL,
      created_at INTEGER NOT NULL,
      fetched_at TEXT DEFAULT (datetime('now')),
      relays TEXT NOT NULL,
      electrum_servers TEXT NOT NULL,
      exchange_rates TEXT NOT NULL,
      split TEXT,
      version TEXT,
      valid_from INTEGER,
      split_started_at INTEGER,
      trusted_signers TEXT,
      raw_event TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS lash_users_history (
      id TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(16)))),
      event_id TEXT NOT NULL,
      nostr_hex_id TEXT NOT NULL,
      created_at TEXT DEFAULT (datetime('now')),
      UNIQUE(event_id, nostr_hex_id)
    );

    CREATE TABLE IF NOT EXISTS nostr_profiles (
      nostr_hex_id TEXT PRIMARY KEY,
      full_name TEXT,
      display_name TEXT,
      picture TEXT,
      about TEXT,
      lana_wallet_id TEXT,
      raw_metadata TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now')),
      last_fetched_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS push_subscriptions (
      id TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(16)))),
      nostr_hex_id TEXT NOT NULL,
      endpoint TEXT NOT NULL,
      p256dh TEXT NOT NULL,
      auth TEXT NOT NULL,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now')),
      UNIQUE(nostr_hex_id, endpoint)
    );

    CREATE TABLE IF NOT EXISTS room_latest_posts (
      id TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(16)))),
      room_slug TEXT NOT NULL UNIQUE,
      post_event_id TEXT NOT NULL,
      content TEXT NOT NULL,
      author_pubkey TEXT NOT NULL,
      created_at INTEGER NOT NULL,
      image_url TEXT,
      post_count INTEGER DEFAULT 0,
      fetched_at TEXT DEFAULT (datetime('now')),
      updated_at TEXT DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS transaction_history (
      id TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(16)))),
      txid TEXT NOT NULL,
      sender_pubkey TEXT NOT NULL,
      block_height INTEGER NOT NULL,
      block_time INTEGER NOT NULL,
      used_utxos TEXT NOT NULL,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS wallet_types (
      id TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(16)))),
      name TEXT NOT NULL UNIQUE,
      description TEXT,
      is_active INTEGER NOT NULL DEFAULT 1,
      display_order INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS ai_pending_tasks (
      id TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(16)))),
      nostr_hex_id TEXT NOT NULL,
      question TEXT NOT NULL,
      language TEXT NOT NULL DEFAULT 'sl',
      missing_fields TEXT NOT NULL,
      partial_context TEXT NOT NULL,
      partial_answer TEXT,
      status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','processing','completed','expired','cancelled')),
      retry_count INTEGER NOT NULL DEFAULT 0,
      max_retries INTEGER NOT NULL DEFAULT 5,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now')),
      completed_at TEXT,
      full_answer TEXT,
      usd_to_lana_rate REAL DEFAULT 270
    );

    CREATE TABLE IF NOT EXISTS encrypted_room_read_status (
      id TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(16)))),
      user_nostr_id TEXT NOT NULL,
      room_event_id TEXT NOT NULL,
      last_read_at INTEGER NOT NULL DEFAULT 0,
      created_at TEXT DEFAULT (datetime('now')),
      updated_at TEXT DEFAULT (datetime('now')),
      UNIQUE(user_nostr_id, room_event_id)
    );

    CREATE TABLE IF NOT EXISTS bug_reports (
      id TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(16)))),
      nostr_hex_id TEXT NOT NULL,
      type TEXT NOT NULL DEFAULT 'bug' CHECK (type IN ('bug', 'feature')),
      title TEXT NOT NULL,
      description TEXT NOT NULL,
      images TEXT DEFAULT '[]',
      notify_method TEXT DEFAULT '',
      notify_contact TEXT DEFAULT '',
      status TEXT NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'in_progress', 'resolved', 'closed', 'wont_fix')),
      admin_notes TEXT DEFAULT '',
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS pending_nostr_events (
      id TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(16)))),
      event_id TEXT NOT NULL UNIQUE,
      event_kind INTEGER NOT NULL,
      signed_event TEXT NOT NULL,
      user_pubkey TEXT NOT NULL,
      retry_count INTEGER NOT NULL DEFAULT 0,
      max_retries INTEGER NOT NULL DEFAULT 20,
      status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','published')),
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      last_attempt_at TEXT,
      published_at TEXT
    );

    CREATE TABLE IF NOT EXISTS whats_up (
      id TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(16)))),
      title TEXT NOT NULL,
      body TEXT,
      youtube_url TEXT,
      published INTEGER NOT NULL DEFAULT 1,
      created_by TEXT,
      created_at TEXT DEFAULT (datetime('now')),
      updated_at TEXT DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS faq (
      id TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(16)))),
      title TEXT NOT NULL,
      youtube_url TEXT,
      display_order INTEGER NOT NULL DEFAULT 0,
      published INTEGER NOT NULL DEFAULT 1,
      created_by TEXT,
      created_at TEXT DEFAULT (datetime('now')),
      updated_at TEXT DEFAULT (datetime('now'))
    );

    -- =============================================
    -- INDEXES
    -- =============================================

    CREATE INDEX IF NOT EXISTS idx_ai_pending_tasks_status ON ai_pending_tasks(status);
    CREATE INDEX IF NOT EXISTS idx_ai_pending_tasks_nostr ON ai_pending_tasks(nostr_hex_id);
    CREATE INDEX IF NOT EXISTS idx_ai_knowledge_slug ON ai_knowledge(slug);
    CREATE INDEX IF NOT EXISTS idx_ai_knowledge_status ON ai_knowledge(status);
    CREATE INDEX IF NOT EXISTS idx_ai_usage_logs_nostr_hex_id ON ai_usage_logs(nostr_hex_id);
    CREATE INDEX IF NOT EXISTS idx_ai_usage_logs_created_at ON ai_usage_logs(created_at);
    CREATE INDEX IF NOT EXISTS idx_ai_unsupported_prompts_created_at ON ai_unsupported_prompts(created_at);
    CREATE INDEX IF NOT EXISTS idx_ai_unsupported_prompts_nostr_hex_id ON ai_unsupported_prompts(nostr_hex_id);
    CREATE INDEX IF NOT EXISTS idx_dm_created_at ON direct_messages(created_at);
    CREATE INDEX IF NOT EXISTS idx_dm_event_id ON direct_messages(event_id);
    CREATE INDEX IF NOT EXISTS idx_dm_sender_time ON direct_messages(sender_pubkey, created_at);
    CREATE INDEX IF NOT EXISTS idx_dm_recipient_time ON direct_messages(recipient_pubkey, created_at);
    CREATE INDEX IF NOT EXISTS idx_dm_lashes_created ON dm_lashes(created_at);
    CREATE INDEX IF NOT EXISTS idx_dm_lashes_message ON dm_lashes(message_event_id);
    CREATE INDEX IF NOT EXISTS idx_dm_lashes_sender ON dm_lashes(sender_pubkey);
    CREATE INDEX IF NOT EXISTS idx_dm_read_status_user ON dm_read_status(user_nostr_id);
    CREATE INDEX IF NOT EXISTS idx_dm_read_status_sender ON dm_read_status(sender_pubkey);
    CREATE INDEX IF NOT EXISTS idx_dm_read_status_conversation_unread ON dm_read_status(user_nostr_id, conversation_pubkey, is_read);
    CREATE INDEX IF NOT EXISTS idx_kind_38888_created_at ON kind_38888(created_at);
    CREATE INDEX IF NOT EXISTS idx_lash_users_history_event_id ON lash_users_history(event_id);
    CREATE INDEX IF NOT EXISTS idx_lash_users_history_nostr_hex_id ON lash_users_history(nostr_hex_id);
    CREATE INDEX IF NOT EXISTS idx_nostr_profiles_display_name ON nostr_profiles(display_name);
    CREATE INDEX IF NOT EXISTS idx_nostr_profiles_full_name ON nostr_profiles(full_name);
    CREATE INDEX IF NOT EXISTS idx_nostr_profiles_last_fetched ON nostr_profiles(last_fetched_at);
    CREATE INDEX IF NOT EXISTS idx_push_subscriptions_nostr_hex_id ON push_subscriptions(nostr_hex_id);
    CREATE INDEX IF NOT EXISTS idx_room_latest_posts_created ON room_latest_posts(created_at);
    CREATE INDEX IF NOT EXISTS idx_room_latest_posts_slug ON room_latest_posts(room_slug);
    CREATE INDEX IF NOT EXISTS idx_transaction_history_sender_block ON transaction_history(sender_pubkey, block_height);
    CREATE INDEX IF NOT EXISTS idx_transaction_history_txid ON transaction_history(txid);
    CREATE INDEX IF NOT EXISTS idx_enc_room_read_user ON encrypted_room_read_status(user_nostr_id);
    CREATE INDEX IF NOT EXISTS idx_enc_room_read_room ON encrypted_room_read_status(room_event_id);
    CREATE INDEX IF NOT EXISTS idx_bug_reports_status ON bug_reports(status);
    CREATE INDEX IF NOT EXISTS idx_bug_reports_nostr ON bug_reports(nostr_hex_id);
    CREATE INDEX IF NOT EXISTS idx_bug_reports_created ON bug_reports(created_at);
    CREATE INDEX IF NOT EXISTS idx_bug_reports_type ON bug_reports(type);
    CREATE INDEX IF NOT EXISTS idx_pending_nostr_events_status ON pending_nostr_events(status);
    CREATE INDEX IF NOT EXISTS idx_pending_nostr_events_user ON pending_nostr_events(user_pubkey);
    CREATE INDEX IF NOT EXISTS idx_whats_up_created ON whats_up(created_at);
    CREATE INDEX IF NOT EXISTS idx_faq_order ON faq(display_order);
  `);

  console.log('SQLite schema initialized (22 tables + indexes)');
}
