import { Router, Request, Response } from 'express';

const router = Router();

// Store active SSE connections by user nostr_hex_id
const sseClients = new Map<string, Set<Response>>();

// Store SSE connections for system parameter updates (heartbeat)
const systemParamsClients = new Set<Response>();

// =============================================
// SSE: System Parameters (heartbeat) updates
// =============================================
router.get('/system-params', (req: Request, res: Response) => {
  // Set SSE headers
  res.writeHead(200, {
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache',
    'Connection': 'keep-alive',
    'Access-Control-Allow-Origin': '*',
  });

  // Send initial connection event
  res.write(`data: ${JSON.stringify({ type: 'connected' })}\n\n`);

  // Register client
  systemParamsClients.add(res);
  console.log(`📡 System params SSE client connected (total: ${systemParamsClients.size})`);

  // Keep alive ping every 30 seconds
  const keepAlive = setInterval(() => {
    try {
      res.write(': keepalive\n\n');
    } catch {
      clearInterval(keepAlive);
    }
  }, 30000);

  // Handle client disconnect
  req.on('close', () => {
    clearInterval(keepAlive);
    systemParamsClients.delete(res);
    console.log(`📡 System params SSE client disconnected (total: ${systemParamsClients.size})`);
  });
});

/**
 * Notify all connected clients that system parameters have been updated.
 * Clients should re-fetch from the database.
 */
export function emitSystemParametersUpdate(data: any): void {
  if (systemParamsClients.size === 0) return;

  const payload = JSON.stringify({
    type: 'system_params_updated',
    ...data
  });

  console.log(`📡 Broadcasting system params update to ${systemParamsClients.size} clients`);

  for (const client of systemParamsClients) {
    try {
      client.write(`data: ${payload}\n\n`);
    } catch (err) {
      systemParamsClients.delete(client);
    }
  }
}

// =============================================
// SSE: DM Read Status updates
// =============================================

// SSE endpoint for dm_read_status realtime updates
router.get('/dm-read-status', (req: Request, res: Response) => {
  const userId = req.query.user as string;

  if (!userId) {
    return res.status(400).json({ error: 'Missing user parameter' });
  }

  // Set SSE headers
  res.writeHead(200, {
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache',
    'Connection': 'keep-alive',
    'Access-Control-Allow-Origin': '*',
  });

  // Send initial connection event
  res.write(`data: ${JSON.stringify({ type: 'connected' })}\n\n`);

  // Register client
  if (!sseClients.has(userId)) {
    sseClients.set(userId, new Set());
  }
  sseClients.get(userId)!.add(res);

  console.log(`SSE client connected for user ${userId.slice(0, 8)}... (total: ${sseClients.get(userId)!.size})`);

  // Keep alive ping every 30 seconds
  const keepAlive = setInterval(() => {
    try {
      res.write(': keepalive\n\n');
    } catch {
      clearInterval(keepAlive);
    }
  }, 30000);

  // Handle client disconnect
  req.on('close', () => {
    clearInterval(keepAlive);
    const clients = sseClients.get(userId);
    if (clients) {
      clients.delete(res);
      if (clients.size === 0) {
        sseClients.delete(userId);
      }
    }
    console.log(`SSE client disconnected for user ${userId.slice(0, 8)}...`);
  });
});

// Function to emit dm_read_status updates to connected clients
export function emitDmReadStatusUpdate(data: any): void {
  const userId = data.user_nostr_id;
  if (!userId) return;

  const clients = sseClients.get(userId);
  if (!clients || clients.size === 0) return;

  const payload = JSON.stringify({
    type: 'dm_read_status_update',
    eventType: 'UPDATE',
    schema: 'public',
    table: 'dm_read_status',
    new: data
  });

  for (const client of clients) {
    try {
      client.write(`data: ${payload}\n\n`);
    } catch (err) {
      // Client disconnected, remove it
      clients.delete(client);
    }
  }
}

// =============================================
// SSE: AI Task Updates (async AI responses)
// =============================================

const aiTaskClients = new Map<string, Set<Response>>();

router.get('/ai-tasks', (req: Request, res: Response) => {
  const userId = req.query.user as string;

  if (!userId) {
    return res.status(400).json({ error: 'Missing user parameter' });
  }

  res.writeHead(200, {
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache',
    'Connection': 'keep-alive',
    'Access-Control-Allow-Origin': '*',
  });

  res.write(`data: ${JSON.stringify({ type: 'connected' })}\n\n`);

  if (!aiTaskClients.has(userId)) {
    aiTaskClients.set(userId, new Set());
  }
  aiTaskClients.get(userId)!.add(res);

  console.log(`🧠 AI task SSE client connected for ${userId.slice(0, 8)}... (total: ${aiTaskClients.get(userId)!.size})`);

  const keepAlive = setInterval(() => {
    try { res.write(': keepalive\n\n'); } catch { clearInterval(keepAlive); }
  }, 30000);

  req.on('close', () => {
    clearInterval(keepAlive);
    const clients = aiTaskClients.get(userId);
    if (clients) {
      clients.delete(res);
      if (clients.size === 0) aiTaskClients.delete(userId);
    }
    console.log(`🧠 AI task SSE client disconnected for ${userId.slice(0, 8)}...`);
  });
});

export function emitAiTaskUpdate(nostrHexId: string, data: any): void {
  const clients = aiTaskClients.get(nostrHexId);
  if (!clients || clients.size === 0) return;

  const payload = JSON.stringify({ type: 'ai_task_update', ...data });
  for (const client of clients) {
    try { client.write(`data: ${payload}\n\n`); } catch { clients.delete(client); }
  }
}

export function isUserConnectedToAiTasks(nostrHexId: string): boolean {
  const clients = aiTaskClients.get(nostrHexId);
  return !!(clients && clients.size > 0);
}

export default router;
