import express from 'express';
import cors from 'cors';
import path from 'path';
import { fileURLToPath } from 'url';
import { getDb, closeDb } from './db/connection';
import { fetchKind38888, refreshStaleProfiles, discoverNewProfiles, cleanupOrphanedProfiles, syncProjectFundedStatus } from './lib/nostr';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
import dbRoutes from './routes/db';
import storageRoutes from './routes/storage';
import sseRoutes, { emitSystemParametersUpdate, emitAiTaskUpdate, isUserConnectedToAiTasks } from './routes/sse';
import functionsRoutes, { retryPendingNostrEvents } from './routes/functions';
import voiceRoutes from './routes/voice';
import { processPendingTasks, setSSEHandlers } from './lib/aiTasks';
import { syncUnregisteredLana } from './lib/unregisteredLana';

const app = express();
const PORT = process.env.PORT || 3001;

// Middleware
app.use(cors({
  origin: [
    'http://localhost:5173',   // Vite dev server (default)
    'http://localhost:8080',   // Vite dev server (custom port)
    'http://localhost:4173',   // Vite preview
    'http://localhost:3001',   // Self
    'https://new.mejmosefajn.org',  // Production
    'https://app.lanaloves.us',    // Main app domain
    'https://lanaloves.us',         // Public landing page
    'https://www.lanaloves.us',     // Public landing page (www)
  ],
  credentials: true,
}));

app.use(express.json({ limit: '50mb' }));
app.use(express.urlencoded({ extended: true, limit: '50mb' }));

// Request logging
app.use((req, res, next) => {
  const start = Date.now();
  res.on('finish', () => {
    const duration = Date.now() - start;
    if (!req.url.includes('/api/sse/')) { // Don't log SSE keepalives
      console.log(`${req.method} ${req.url} ${res.statusCode} ${duration}ms`);
    }
  });
  next();
});

// Initialize database on startup
console.log('Initializing SQLite database...');
const db = getDb();

// =============================================
// KIND 38888 Sync — reusable function + heartbeat
// =============================================

const HEARTBEAT_INTERVAL = 60 * 1000; // 1 minute (was 1 hour)

/**
 * Sync KIND 38888 from Lana relays and save to database.
 * Called on startup and then every heartbeat (1 minute).
 * Compares created_at with DB — only updates if newer event found.
 * Returns true if sync was successful (data was updated or already up-to-date).
 */
async function syncKind38888ToDb(): Promise<boolean> {
  try {
    const data = await fetchKind38888();
    if (data) {
      // Check if we already have this event (compare created_at)
      const existing = db.prepare(
        'SELECT created_at, event_id FROM kind_38888 ORDER BY created_at DESC LIMIT 1'
      ).get() as { created_at: number; event_id: string } | undefined;

      if (existing && existing.created_at >= data.created_at) {
        // Already up-to-date, no need to update
        return true;
      }

      // New or updated event — save to DB
      db.prepare('DELETE FROM kind_38888').run();
      db.prepare(`
        INSERT INTO kind_38888 (
          id, event_id, pubkey, created_at, relays, electrum_servers,
          exchange_rates, split, version, valid_from, trusted_signers, raw_event
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).run(
        'synced_' + Date.now(),
        data.event_id,
        data.pubkey,
        data.created_at,
        JSON.stringify(data.relays),
        JSON.stringify(data.electrum_servers),
        JSON.stringify(data.exchange_rates),
        data.split,
        data.version,
        data.valid_from,
        JSON.stringify(data.trusted_signers),
        data.raw_event
      );
      console.log(`✅ KIND 38888 updated: version ${data.version}, ${data.relays.length} relays (was: ${existing?.event_id || 'none'})`);
      console.log(`📡 Relays: ${data.relays.join(', ')}`);

      // Notify connected SSE clients about the update
      emitSystemParametersUpdate({
        event_id: data.event_id,
        version: data.version,
        relayCount: data.relays.length,
        syncedAt: Date.now()
      });

      return true;
    } else {
      console.warn('⚠️ Could not fetch KIND 38888 from relays');
      return false;
    }
  } catch (error) {
    console.error('❌ KIND 38888 sync failed:', error);
    return false;
  }
}

// Auto-sync on startup
(async () => {
  console.log('🔄 Auto-syncing KIND 38888 from Lana relays...');
  const ok = await syncKind38888ToDb();
  if (!ok) {
    console.warn('⚠️ Using seed data as fallback');
  }
  // Discover new profiles on startup so the DB is always current
  try {
    await discoverNewProfiles(db);
  } catch (err) {
    console.error('❌ Startup profile discovery failed:', err);
  }
  // Sync project funded status on startup
  try {
    await syncProjectFundedStatus(db);
  } catch (err) {
    console.error('❌ Startup project funded sync failed:', err);
  }
})();

// =============================================
// Heartbeat — 1 minute interval
// KIND 38888 sync every heartbeat (smart: only updates DB if newer)
// AI pending tasks processed every heartbeat
// =============================================

// Wire up SSE handlers for async AI task delivery
setSSEHandlers(emitAiTaskUpdate, isUserConnectedToAiTasks);

let heartbeatCount = 0;

/** Wraps an async operation with a timeout to prevent it from blocking the heartbeat forever */
function withTimeout<T>(fn: () => Promise<T>, label: string, ms: number): Promise<T | undefined> {
  return Promise.race([
    fn(),
    new Promise<undefined>((resolve) =>
      setTimeout(() => {
        console.warn(`⏰ ${label} timed out after ${ms / 1000}s — skipping this cycle`);
        resolve(undefined);
      }, ms)
    ),
  ]);
}

const heartbeatTimer = setInterval(async () => {
  heartbeatCount++;

  // KIND 38888 sync every heartbeat (smart: only updates DB if event is newer)
  await withTimeout(() => syncKind38888ToDb(), 'KIND 38888 sync', 45000);

  // Process pending AI tasks every heartbeat (every minute)
  try {
    await withTimeout(() => processPendingTasks(db), 'AI tasks', 30000);
  } catch (err) {
    console.error('❌ Error processing pending AI tasks:', err);
  }

  // Retry pending Nostr events every 5 heartbeats (= every 5 minutes)
  if (heartbeatCount % 5 === 0) {
    try {
      await withTimeout(() => retryPendingNostrEvents(db), 'retryPendingNostrEvents', 30000);
    } catch (err) {
      console.error('❌ Error retrying pending Nostr events:', err);
    }
  }

  // Refresh stale profiles every 10 heartbeats (= every 10 minutes)
  if (heartbeatCount % 10 === 0) {
    try {
      await withTimeout(() => refreshStaleProfiles(db), 'refreshStaleProfiles', 45000);
    } catch (err) {
      console.error('❌ Error refreshing stale profiles:', err);
    }
  }

  // Full paginated profile discovery every 30 heartbeats (= every 30 minutes)
  // This walks ALL pages across all Lana relays — catches profiles missed by single-page queries
  if (heartbeatCount % 30 === 0) {
    try {
      await withTimeout(() => discoverNewProfiles(db), 'discoverNewProfiles', 120000);
    } catch (err) {
      console.error('❌ Error discovering new profiles:', err);
    }
  }

  // Cleanup orphaned profiles once daily (every 1440 heartbeats = 24 hours)
  if (heartbeatCount % 1440 === 0) {
    try {
      await withTimeout(() => cleanupOrphanedProfiles(db), 'cleanupOrphanedProfiles', 300000);
    } catch (err) {
      console.error('❌ Error cleaning up orphaned profiles:', err);
    }
  }

  // Sync project funded status (KIND 31234 + KIND 60200) every 30 heartbeats (= every 30 minutes)
  if (heartbeatCount % 30 === 0) {
    try {
      await withTimeout(() => syncProjectFundedStatus(db), 'syncProjectFundedStatus', 120000);
    } catch (err) {
      console.error('❌ Error syncing project funded status:', err);
    }
  }

  // Sync unregistered LANA (KIND 87003/87009) every 10 heartbeats (= every 10 minutes)
  if (heartbeatCount % 10 === 0) {
    try {
      await withTimeout(() => syncUnregisteredLana(db), 'syncUnregisteredLana', 30000);
    } catch (err) {
      console.error('❌ Error syncing unregistered LANA:', err);
    }
  }
}, HEARTBEAT_INTERVAL);

console.log(`💓 Heartbeat started: every ${HEARTBEAT_INTERVAL / 1000}s (KIND 38888 every beat, AI tasks every minute, relay retry every 5min, stale profile refresh every 10min, full profile discovery every 30min, orphaned profile cleanup every 24h, unreg LANA every 10min)`);

// =============================================
// API Routes
// =============================================

// Database CRUD API
app.use('/api/db', dbRoutes);

// File Storage API
app.use('/api/storage', storageRoutes);

// Server-Sent Events (Realtime)
app.use('/api/sse', sseRoutes);

// Edge Functions (converted to Express routes)
app.use('/api/functions', functionsRoutes);

// Voice proxy routes (STT, TTS, Sožitje)
app.use('/api/voice', voiceRoutes);

// =============================================
// Static Frontend (production)
// =============================================

const distPath = path.resolve(__dirname, '../dist');
app.use(express.static(distPath));

// SPA fallback - serve index.html for all non-API routes
// Express 5 requires named wildcard parameter
app.get('/{*path}', (req, res) => {
  if (req.url.startsWith('/api/')) {
    return res.status(404).json({ error: 'API endpoint not found' });
  }
  res.sendFile(path.join(distPath, 'index.html'));
});

// =============================================
// Start Server
// =============================================

app.listen(PORT, () => {
  console.log(`
=========================================
  MejMoSeFajn Server
  Port: ${PORT}
  Database: SQLite (data/mejmosefajn.db)
  Storage: server/uploads/
=========================================
  API:     http://localhost:${PORT}/api
  Frontend: http://localhost:${PORT}
=========================================
  `);
});

// Graceful shutdown
process.on('SIGINT', () => {
  console.log('\nShutting down...');
  clearInterval(heartbeatTimer);
  closeDb();
  process.exit(0);
});

process.on('SIGTERM', () => {
  console.log('\nShutting down...');
  clearInterval(heartbeatTimer);
  closeDb();
  process.exit(0);
});

export default app;
