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
  status: string;
  error?: string;
}

/**
 * Connect to the first available Electrum server
 */
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
              const totalLana = (confirmed + unconfirmed) / LANOSHI_DIVISOR;
              return {
                wallet_id: address,
                balance: Math.round(totalLana * 100) / 100,
                status: totalLana > 0 ? 'active' : 'inactive'
              };
            } else {
              const errorMsg = resp?.error?.message || 'No response';
              return {
                wallet_id: address,
                balance: 0,
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
