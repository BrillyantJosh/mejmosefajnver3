const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

interface ElectrumServer {
  host: string;
  port: string;
}

interface WalletBalance {
  wallet_id: string;
  balance: number;
  status: string;
  error?: string;
}

class ElectrumBalanceAggregator {
  servers: ElectrumServer[] = [];

  constructor(servers: ElectrumServer[]) {
    this.servers = servers;
    console.log(`Initialized with ${this.servers.length} Electrum servers`);
  }

  async fetchWalletBalances(walletAddresses: string[]): Promise<WalletBalance[]> {
    if (this.servers.length === 0) {
      throw new Error('No Electrum servers available');
    }

    console.log(`Starting balance fetch for ${walletAddresses.length} wallets`);

    // Try servers in order
    for (const server of this.servers) {
      try {
        console.log(`Attempting with server: ${server.host}:${server.port}`);
        const result = await this.processBatchWithServer(server, walletAddresses);
        if (result.success) {
          console.log(`Batch completed with ${server.host}: ${result.balances.length} balances fetched`);
          return result.balances;
        }
      } catch (error) {
        console.warn(`Server ${server.host} failed:`, error);
        continue;
      }
    }

    throw new Error('All Electrum servers failed');
  }

  async processBatchWithServer(server: ElectrumServer, walletAddresses: string[]) {
    const balances: WalletBalance[] = [];
    const errors: string[] = [];
    const BATCH_SIZE = 50;

    try {
      // Process wallets in batches
      for (let i = 0; i < walletAddresses.length; i += BATCH_SIZE) {
        const batch = walletAddresses.slice(i, i + BATCH_SIZE);
        console.log(`Processing batch ${Math.floor(i / BATCH_SIZE) + 1}/${Math.ceil(walletAddresses.length / BATCH_SIZE)} with ${batch.length} addresses`);

        const batchResults = await this.fetchBatchBalances(server, batch);
        balances.push(...batchResults.balances);
        errors.push(...batchResults.errors);

        // Small delay between batches
        if (i + BATCH_SIZE < walletAddresses.length) {
          await new Promise((resolve) => setTimeout(resolve, 100));
        }
      }

      return {
        success: true,
        balances,
        errors,
        server_used: server.host,
      };
    } catch (error) {
      throw error;
    }
  }

  async fetchBatchBalances(server: ElectrumServer, addresses: string[]) {
    return new Promise<{ balances: WalletBalance[]; errors: string[] }>(async (resolve, reject) => {
      let conn: Deno.Conn | null = null;

      // Keep this tight; balance lookup should not stall the whole app.
      const CONNECT_AND_READ_TIMEOUT_MS = 4500;
      const startedAt = Date.now();

      const timeout = setTimeout(() => {
        try {
          conn?.close();
        } catch {
          // ignore
        }
        reject(new Error('Connection timeout'));
      }, CONNECT_AND_READ_TIMEOUT_MS);

      try {
        // Connect to Electrum server
        conn = await Deno.connect({
          hostname: server.host,
          port: parseInt(server.port),
        });

        const balances: WalletBalance[] = [];
        const errors: string[] = [];
        let requestId = 1;

        // Send batch requests
        for (const address of addresses) {
          const request = {
            id: requestId++,
            method: 'blockchain.address.get_balance',
            params: [address],
          };
          const requestData = JSON.stringify(request) + '\n';
          await conn.write(new TextEncoder().encode(requestData));
        }

        // Read responses
        const decoder = new TextDecoder();
        let buffer = '';
        const responses = new Map<number, any>();

        while (responses.size < addresses.length) {
          if (Date.now() - startedAt > CONNECT_AND_READ_TIMEOUT_MS) {
            break;
          }

          const chunk = new Uint8Array(4096);
          const bytesRead = await conn.read(chunk);
          if (bytesRead === null) break;

          buffer += decoder.decode(chunk.subarray(0, bytesRead));

          // Process complete lines
          const lines = buffer.split('\n');
          buffer = lines.pop() || '';

          for (const line of lines) {
            if (!line.trim()) continue;
            try {
              const response = JSON.parse(line);
              if (typeof response?.id === 'number') {
                responses.set(response.id, response);
              }
            } catch {
              console.warn('Failed to parse response:', line);
            }
          }
        }

        // Process responses
        for (let i = 0; i < addresses.length; i++) {
          const address = addresses[i];
          const responseId = i + 1;
          const response = responses.get(responseId);

          if (response && response.result) {
            const confirmedBalance = response.result.confirmed || 0;
            const unconfirmedBalance = response.result.unconfirmed || 0;
            const totalBalance = (confirmedBalance + unconfirmedBalance) / 100000000; // Convert from lanoshis

            balances.push({
              wallet_id: address,
              balance: Math.round(totalBalance * 100) / 100,
              status: totalBalance > 0 ? 'active' : 'inactive',
            });
          } else {
            const errorMsg = response?.error?.message || 'No response received';
            errors.push(`${address}: ${errorMsg}`);
            balances.push({
              wallet_id: address,
              balance: 0,
              status: 'inactive',
              error: errorMsg,
            });
          }
        }

        clearTimeout(timeout);
        try {
          conn.close();
        } catch {
          // ignore
        }

        resolve({ balances, errors });
      } catch (error) {
        clearTimeout(timeout);
        try {
          conn?.close();
        } catch {
          // ignore
        }
        reject(error);
      }
    });
  }
}

Deno.serve(async (req) => {
  // Handle CORS preflight requests
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    console.log('Electrum Balance Aggregator started');

    // Parse request body
    let requestBody: any = null;
    try {
      const text = await req.text();
      if (text) requestBody = JSON.parse(text);
    } catch {
      // Ignore parsing errors
    }

    const walletAddresses = requestBody?.wallet_addresses || [];
    const electrumServers = requestBody?.electrum_servers || [];

    if (!Array.isArray(walletAddresses) || walletAddresses.length === 0) {
      return new Response(
        JSON.stringify({
          error: 'wallet_addresses array is required',
          timestamp: new Date().toISOString(),
        }),
        {
          status: 400,
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        }
      );
    }

    if (!Array.isArray(electrumServers) || electrumServers.length === 0) {
      return new Response(
        JSON.stringify({
          error: 'electrum_servers array is required',
          timestamp: new Date().toISOString(),
        }),
        {
          status: 400,
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        }
      );
    }

    console.log(`Processing ${walletAddresses.length} wallet addresses with ${electrumServers.length} servers`);

    // Initialize and fetch balances
    const aggregator = new ElectrumBalanceAggregator(electrumServers);

    let balances: WalletBalance[] = [];
    let globalError: string | null = null;

    try {
      balances = await aggregator.fetchWalletBalances(walletAddresses);
    } catch (e) {
      globalError = e instanceof Error ? e.message : 'Unknown error';
      console.error('Failed to fetch balances from all servers:', globalError);
      balances = walletAddresses.map((address: string) => ({
        wallet_id: address,
        balance: 0,
        status: 'inactive',
        error: globalError || 'Unknown error',
      }));
    }

    // Calculate totals
    const totalBalance = balances.reduce((sum, b) => sum + b.balance, 0);
    const successCount = balances.filter((b) => !b.error).length;
    const errorCount = balances.filter((b) => b.error).length;

    const result = {
      success: successCount > 0,
      total_balance: Math.round(totalBalance * 100) / 100,
      wallets: balances,
      success_count: successCount,
      error_count: errorCount,
      global_error: globalError,
      timestamp: new Date().toISOString(),
    };

    console.log(
      `Electrum aggregation completed: ${successCount} success, ${errorCount} errors, total: ${result.total_balance} LANA`
    );

    // Always return 200 so the client can handle errors gracefully.
    return new Response(JSON.stringify(result), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  } catch (error) {
    console.error('Error in Electrum balance aggregator:', error);
    return new Response(
      JSON.stringify({
        success: false,
        error: error instanceof Error ? error.message : 'Unknown error',
        timestamp: new Date().toISOString(),
      }),
      {
        status: 500,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      }
    );
  }
});

