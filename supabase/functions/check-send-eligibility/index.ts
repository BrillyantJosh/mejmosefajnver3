import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.76.1';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type'
};

interface ElectromServer {
  host: string;
  port: number;
}

async function connectElectrum(server: ElectromServer, maxRetries = 3): Promise<Deno.TcpConn> {
  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    try {
      console.log(`🔌 Connecting to ${server.host}:${server.port} (attempt ${attempt})`);
      const conn = await Deno.connect({ hostname: server.host, port: server.port, transport: 'tcp' });
      console.log(`✅ Connected to ${server.host}:${server.port}`);
      return conn;
    } catch (error) {
      if (attempt === maxRetries) throw error;
      await new Promise(resolve => setTimeout(resolve, 1000 * attempt));
    }
  }
  throw new Error(`Failed to connect to ${server.host}:${server.port}`);
}

async function electrumCall(
  method: string,
  params: any[],
  servers: ElectromServer[],
  timeout = 10000
): Promise<any> {
  for (const server of servers) {
    try {
      const conn = await connectElectrum(server);
      
      const id = Math.floor(Math.random() * 1000000);
      const request = JSON.stringify({ jsonrpc: '2.0', method, params, id }) + '\n';
      console.log(`📤 Electrum ${method}:`, JSON.stringify(params));
      
      await conn.write(new TextEncoder().encode(request));
      
      const response = await Promise.race([
        (async () => {
          const buffer = new Uint8Array(65536);
          const n = await conn.read(buffer);
          if (!n) throw new Error('Empty response');
          return new TextDecoder().decode(buffer.subarray(0, n));
        })(),
        new Promise<never>((_, reject) =>
          setTimeout(() => reject(new Error(`Electrum call timeout after ${timeout}ms`)), timeout)
        )
      ]);
      
      conn.close();
      
      const json = JSON.parse(response.split('\n')[0]);
      if (json.error) throw new Error(JSON.stringify(json.error));
      return json.result;
    } catch (error) {
      console.warn(`⚠️ Electrum call failed on ${server.host}:`, error);
      if (server === servers[servers.length - 1]) throw error;
    }
  }
  throw new Error('All Electrum servers failed');
}

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const { senderPubkey } = await req.json();

    if (!senderPubkey) {
      return new Response(
        JSON.stringify({ success: false, error: 'senderPubkey is required' }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    console.log(`🔍 Checking send eligibility for sender: ${senderPubkey.slice(0, 16)}...`);

    // Initialize Supabase
    const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
    const supabaseKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
    const supabaseClient = createClient(supabaseUrl, supabaseKey);

    // Get current block height
    const servers: ElectromServer[] = [
      { host: "electrum1.lanacoin.com", port: 5097 },
      { host: "electrum2.lanacoin.com", port: 5097 }
    ];

    const headerInfo = await electrumCall('blockchain.headers.subscribe', [], servers);
    const currentBlockHeight = headerInfo?.height || headerInfo?.block_height || 0;
    const currentBlockTime = headerInfo?.timestamp || Math.floor(Date.now() / 1000);

    console.log(`📦 Current Block: ${currentBlockHeight}, Time: ${currentBlockTime}`);

    // Check last transaction
    const { data: lastTx, error } = await supabaseClient
      .from('transaction_history')
      .select('block_height, block_time')
      .eq('sender_pubkey', senderPubkey)
      .order('block_height', { ascending: false })
      .limit(1)
      .maybeSingle();

    if (error) {
      console.error('❌ Error querying transaction history:', error);
      return new Response(
        JSON.stringify({
          canSend: true,
          currentBlock: currentBlockHeight,
          blockTime: currentBlockTime
        }),
        { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    if (!lastTx) {
      console.log('✅ No previous transactions - OK to send');
      return new Response(
        JSON.stringify({
          canSend: true,
          currentBlock: currentBlockHeight,
          blockTime: currentBlockTime
        }),
        { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    const lastBlockHeight = lastTx.block_height;
    const canSend = currentBlockHeight > lastBlockHeight;

    console.log(`📊 Last TX: Block ${lastBlockHeight}, Current: ${currentBlockHeight}, Can Send: ${canSend}`);

    return new Response(
      JSON.stringify({
        canSend,
        lastBlock: lastBlockHeight,
        currentBlock: currentBlockHeight,
        blockTime: currentBlockTime,
        error: canSend ? undefined : `Last transaction was in block ${lastBlockHeight}. Wait for block ${lastBlockHeight + 1}.`
      }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );

  } catch (error) {
    console.error('❌ Error checking eligibility:', error);
    return new Response(
      JSON.stringify({
        canSend: true, // Fail-open
        error: error instanceof Error ? error.message : 'Unknown error'
      }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  }
});
