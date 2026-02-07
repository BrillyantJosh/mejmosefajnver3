import express from 'express';
import cors from 'cors';
import path from 'path';
import { fileURLToPath } from 'url';
import { getDb, closeDb } from './db/connection';
import { fetchKind38888 } from './lib/nostr';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
import dbRoutes from './routes/db';
import storageRoutes from './routes/storage';
import sseRoutes from './routes/sse';
import functionsRoutes from './routes/functions';

const app = express();
const PORT = process.env.PORT || 3001;

// Middleware
app.use(cors({
  origin: [
    'http://localhost:5173',   // Vite dev server (default)
    'http://localhost:8080',   // Vite dev server (custom port)
    'http://localhost:4173',   // Vite preview
    'http://localhost:3001',   // Self
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
// Auto-sync KIND 38888 from Lana relays on startup
// This ensures we always have fresh system parameters
// =============================================
(async () => {
  try {
    console.log('🔄 Auto-syncing KIND 38888 from Lana relays...');
    const data = await fetchKind38888();
    if (data) {
      // Delete old entries and insert fresh data
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
      console.log(`✅ KIND 38888 synced on startup: version ${data.version}, ${data.relays.length} relays`);
      console.log(`📡 Relays: ${data.relays.join(', ')}`);
    } else {
      console.warn('⚠️ Could not fetch KIND 38888 from relays, using seed data as fallback');
    }
  } catch (error) {
    console.error('❌ Auto-sync KIND 38888 failed:', error);
    console.warn('⚠️ Using seed data as fallback');
  }
})();

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
  closeDb();
  process.exit(0);
});

process.on('SIGTERM', () => {
  console.log('\nShutting down...');
  closeDb();
  process.exit(0);
});

export default app;
