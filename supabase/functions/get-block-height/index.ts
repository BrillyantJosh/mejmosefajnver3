import { serve } from "https://deno.land/std@0.168.0/http/server.ts";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type'
};

interface ElectrumServer {
  host: string;
  port: string;
}

async function connectElectrum(server: ElectrumServer, maxRetries = 2) {
  for (let attempt = 0; attempt < maxRetries; attempt++) {
    try {
      console.log(`🔌 Connecting to ${server.host}:${server.port} (attempt ${attempt + 1})`);
      const conn = await Deno.connect({
        hostname: server.host,
        port: parseInt(server.port)
      });
      console.log(`✅ Connected to ${server.host}:${server.port}`);
      return conn;
    } catch (error) {
      console.error(`❌ Failed to connect to ${server.host}:${server.port}:`, error);
      if (attempt < maxRetries - 1) {
        await new Promise(resolve => setTimeout(resolve, 500));
      }
    }
  }
  throw new Error(`Failed to connect to ${server.host}:${server.port}`);
}

async function electrumCall(method: string, params: any[], servers: ElectrumServer[], timeout = 15000) {
  for (const server of servers) {
    let conn = null;
    try {
      conn = await connectElectrum(server);
      
      const request = {
        id: Date.now(),
        method,
        params
      };
      
      const requestData = JSON.stringify(request) + '\n';
      console.log(`📤 Electrum ${method}:`, params);
      
      const timeoutPromise = new Promise((_, reject) => {
        setTimeout(() => reject(new Error(`Timeout after ${timeout}ms`)), timeout);
      });
      
      const callPromise = (async () => {
        await conn.write(new TextEncoder().encode(requestData));
        
        let responseText = '';
        const buffer = new Uint8Array(8192);
        
        while (true) {
          const bytesRead = await conn.read(buffer);
          if (!bytesRead) break;
          
          const chunk = new TextDecoder().decode(buffer.slice(0, bytesRead));
          responseText += chunk;
          
          if (responseText.includes('\n')) break;
        }
        
        if (!responseText) {
          throw new Error('No response from Electrum server');
        }
        
        const response = JSON.parse(responseText.trim());
        
        if (response.error) {
          throw new Error(`Electrum error: ${JSON.stringify(response.error)}`);
        }
        
        return response.result;
      })();
      
      const result = await Promise.race([callPromise, timeoutPromise]);
      console.log(`✅ Got result from ${server.host}:${server.port}`);
      return result;
      
    } catch (error) {
      console.error(`❌ Error with ${server.host}:${server.port}:`, error);
    } finally {
      if (conn) {
        try {
          conn.close();
        } catch (e) {
          console.warn('Warning: Failed to close connection:', e);
        }
      }
    }
  }
  
  throw new Error('Failed to get block height from all Electrum servers');
}

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const { electrumServers } = await req.json();

    if (!electrumServers || electrumServers.length === 0) {
      throw new Error('No Electrum servers provided');
    }

    console.log('📊 Fetching block height from Electrum servers...');

    // Get current block height from Electrum
    const headerInfo = await electrumCall(
      'blockchain.headers.subscribe',
      [],
      electrumServers
    );

    let blockHeight: number | null = null;

    if (headerInfo && typeof headerInfo === 'object') {
      if ('height' in headerInfo) {
        blockHeight = headerInfo.height;
      } else if ('block_height' in headerInfo) {
        blockHeight = headerInfo.block_height;
      }
    }

    if (blockHeight === null) {
      throw new Error('Could not fetch current block height');
    }

    console.log(`✅ Current block height: ${blockHeight}`);

    return new Response(
      JSON.stringify({
        success: true,
        blockHeight
      }),
      {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' }
      }
    );
  } catch (error) {
    console.error('❌ Block height error:', error);
    return new Response(
      JSON.stringify({
        success: false,
        error: error instanceof Error ? error.message : 'Unknown error'
      }),
      {
        status: 500,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' }
      }
    );
  }
});
