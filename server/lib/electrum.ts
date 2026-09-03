import * as net from 'net';

/**
 * Electrum TCP client for LANA blockchain queries.
 * Supports both single calls and batch balance queries over one connection.
 */

export interface ElectrumServer {
  host: string;
  port: number;
}

interface WalletBalance {
  wallet_id: string;
  balance: number;
  confirmed_balance: number;
  unconfirmed_balance: number;
  status: string;
  error?: string;
}

/**
 * Connect to the first available Electrum server
 */

/**
 * How many TCP connections this process may have open to Electrum at once.
 *
 * Every call here opens a fresh socket and destroys it — there is no pooling —
 * so a burst of concurrent requests is a burst of connections. That is not
 * theoretical: eighty-two seconds after a deploy, five balance requests
 * arriving within five milliseconds of each other all came back "All Electrum
 * servers failed" while the servers themselves were fine. Clients returning at
 * once after a restart is exactly the shape that produces it.
 *
 * The limit does not make anything slower when there is no contention; it only
 * makes the sixteenth simultaneous caller wait for the fifteenth instead of
 * adding another connection the far end will refuse.
 */
const MAX_CONCURRENT_ELECTRUM = Number(process.env.ELECTRUM_MAX_CONCURRENT || 8);
let activeConnections = 0;
const waiting: Array<() => void> = [];

function acquireSlot(): Promise<void> {
  if (activeConnections < MAX_CONCURRENT_ELECTRUM) {
    activeConnections++;
    return Promise.resolve();
  }
  return new Promise<void>((resolve) => {
    waiting.push(() => { activeConnections++; resolve(); });
  });
}

function releaseSlot(): void {
  activeConnections = Math.max(0, activeConnections - 1);
  waiting.shift()?.();
}

/**
 * Reads that are identical for everyone, answered once.
 *
 * Only the chain tip qualifies: every signed-in tab polls it, the question
 * carries no user parameter, and the answer is the same for all of them.
 * Anything address-specific differs per caller, and a broadcast is a WRITE —
 * neither may ever be shared, so this is an allowlist rather than a rule.
 */
const COALESCABLE = new Set(['blockchain.headers.subscribe']);
const inFlightCalls = new Map<string, Promise<any>>();

/** For diagnostics and tests. */
export function electrumStats() {
  return { active: activeConnections, queued: waiting.length, coalescing: inFlightCalls.size };
}

export async function connectElectrum(servers: ElectrumServer[], maxRetries = 2): Promise<net.Socket> {
  for (let attempt = 0; attempt < maxRetries; attempt++) {
    for (const server of servers) {
      try {
        const socket = await new Promise<net.Socket>((resolve, reject) => {
          const conn = net.connect(server.port, server.host, () => {
            console.log(`⚡ Connected to Electrum ${server.host}:${server.port}`);
            resolve(conn);
          });
          conn.setTimeout(10000);
          conn.on('error', reject);
          conn.on('timeout', () => reject(new Error('Connection timeout')));
        });
        return socket;
      } catch (error: any) {
        console.error(`❌ Electrum ${server.host}:${server.port} failed:`, error.message);
      }
    }
    if (attempt < maxRetries - 1) {
      await new Promise(r => setTimeout(r, 1000));
    }
  }
  throw new Error('Failed to connect to any Electrum server');
}

/**
 * Single Electrum JSON-RPC call (for non-batch operations like block height)
 */
export async function electrumCall(
  method: string,
  params: any[],
  servers: ElectrumServer[],
  timeout = 30000
): Promise<any> {
  // A broadcast is the one write here and must never queue behind reads: it is
  // rare, it is what actually moves money, and a person is waiting on it.
  const isWrite = method === 'blockchain.transaction.broadcast';

  if (!isWrite && COALESCABLE.has(method)) {
    const key = `${method}:${JSON.stringify(params)}`;
    const running = inFlightCalls.get(key);
    if (running) return running;
    const p = electrumCallDirect(method, params, servers, timeout)
      .finally(() => { inFlightCalls.delete(key); });
    inFlightCalls.set(key, p);
    return p;
  }

  return electrumCallDirect(method, params, servers, timeout, isWrite);
}

async function electrumCallDirect(
  method: string,
  params: any[],
  servers: ElectrumServer[],
  timeout = 30000,
  skipLimiter = false
): Promise<any> {
  if (!skipLimiter) await acquireSlot();
  let socket: net.Socket | null = null;
  try {
    socket = await connectElectrum(servers);
    const request = { id: Date.now(), method, params };
    const requestData = JSON.stringify(request) + '\n';

    return await new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        reject(new Error(`Electrum call timeout after ${timeout}ms`));
      }, timeout);

      let responseText = '';

      socket!.on('data', (data: Buffer) => {
        responseText += data.toString();
        if (responseText.includes('\n')) {
          clearTimeout(timer);
          try {
            responseText = responseText.trim();
            const response = JSON.parse(responseText);
            if (response.error) {
              reject(new Error(`Electrum error: ${JSON.stringify(response.error)}`));
            } else {
              resolve(response.result);
            }
          } catch (e) {
            reject(new Error(`Failed to parse Electrum response: ${e}`));
          }
        }
      });

      socket!.on('error', (err) => {
        clearTimeout(timer);
        reject(err);
      });

      socket!.write(requestData);
    });
  } finally {
    if (socket) {
      try { socket.destroy(); } catch {}
    }
    if (!skipLimiter) releaseSlot();
  }
}

/**
 * Batch fetch balances for multiple wallet addresses over a single TCP connection.
 * Mirrors the Deno edge function behavior exactly:
 * - Sends all requests over one connection
 * - Reads all responses
 * - Converts lanoshis to LANA (÷ 100,000,000)
 * - Rounds to 2 decimal places
 */
export async function fetchBatchBalances(
  servers: ElectrumServer[],
  addresses: string[],
  connectionTimeout = 15000
): Promise<WalletBalance[]> {
  // This is the path that failed: five of these arriving within five
  // milliseconds of each other after a deploy all reported "All Electrum
  // servers failed" while the servers were healthy. It opens its own socket
  // rather than going through electrumCall, so it needs the same limit.
  await acquireSlot();
  try {
    return await fetchBatchBalancesInner(servers, addresses, connectionTimeout);
  } finally {
    releaseSlot();
  }
}

async function fetchBatchBalancesInner(
  servers: ElectrumServer[],
  addresses: string[],
  connectionTimeout = 15000
): Promise<WalletBalance[]> {
  // Try servers in order until one works
  for (const server of servers) {
    try {
      console.log(`⚡ Batch balance fetch: ${addresses.length} addresses via ${server.host}:${server.port}`);
      const result = await fetchBatchFromServer(server, addresses, connectionTimeout);
      console.log(`✅ Batch completed via ${server.host}: ${result.length} balances`);
      return result;
    } catch (error: any) {
      console.warn(`⚠️ Server ${server.host}:${server.port} failed:`, error.message);
      continue;
    }
  }
  throw new Error('All Electrum servers failed');
}

async function fetchBatchFromServer(
  server: ElectrumServer,
  addresses: string[],
  timeout: number
): Promise<WalletBalance[]> {
  return new Promise(async (resolve, reject) => {
    let socket: net.Socket | null = null;
    const timer = setTimeout(() => {
      if (socket) socket.destroy();
      reject(new Error('Batch connection timeout'));
    }, timeout);

    try {
      // Connect
      socket = await new Promise<net.Socket>((res, rej) => {
        const conn = net.connect(server.port, server.host, () => res(conn));
        conn.setTimeout(timeout);
        conn.on('error', rej);
        conn.on('timeout', () => rej(new Error('Connection timeout')));
      });

      // Send all balance requests at once over the single connection
      let requestId = 1;
      for (const address of addresses) {
        const request = {
          id: requestId++,
          method: 'blockchain.address.get_balance',
          params: [address]
        };
        socket.write(JSON.stringify(request) + '\n');
      }

      // Collect responses
      const responses = new Map<number, any>();
      let buffer = '';

      socket.on('data', (chunk: Buffer) => {
        buffer += chunk.toString();

        // Process complete JSON lines
        const lines = buffer.split('\n');
        buffer = lines.pop() || ''; // Keep incomplete line in buffer

        for (const line of lines) {
          if (line.trim()) {
            try {
              const response = JSON.parse(line);
              responses.set(response.id, response);
            } catch {
              // Ignore malformed lines
            }
          }
        }

        // Check if we have all responses
        if (responses.size >= addresses.length) {
          clearTimeout(timer);
          socket!.destroy();

          // Build results - convert lanoshis to LANA
          const LANOSHI_DIVISOR = 100000000;
          const balances: WalletBalance[] = addresses.map((address, i) => {
            const resp = responses.get(i + 1);
            if (resp && resp.result) {
              const confirmed = resp.result.confirmed || 0;
              const unconfirmed = resp.result.unconfirmed || 0;
              const confirmedLana = Math.round((confirmed / LANOSHI_DIVISOR) * 100) / 100;
              const unconfirmedLana = Math.round((unconfirmed / LANOSHI_DIVISOR) * 100) / 100;
              const totalLana = Math.round((confirmedLana + unconfirmedLana) * 100) / 100;
              return {
                wallet_id: address,
                balance: totalLana,
                confirmed_balance: confirmedLana,
                unconfirmed_balance: unconfirmedLana,
                status: totalLana > 0 ? 'active' : 'inactive'
              };
            } else {
              const errorMsg = resp?.error?.message || 'No response';
              return {
                wallet_id: address,
                balance: 0,
                confirmed_balance: 0,
                unconfirmed_balance: 0,
                status: 'inactive',
                error: errorMsg
              };
            }
          });

          resolve(balances);
        }
      });

      socket.on('error', (err) => {
        clearTimeout(timer);
        reject(err);
      });

    } catch (error) {
      clearTimeout(timer);
      if (socket) socket.destroy();
      reject(error);
    }
  });
}
