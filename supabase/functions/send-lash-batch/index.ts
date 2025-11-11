import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { ripemd160 } from "https://esm.sh/hash.js@1.1.7";
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.76.1';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type'
};

const BASE58_ALPHABET = '123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz';

// ============ BASE58 ENCODING/DECODING ============
function base58Encode(bytes: Uint8Array): string {
  if (bytes.length === 0) return '';
  let x = BigInt('0x' + uint8ArrayToHex(bytes));
  let result = '';
  while(x > 0n){
    const remainder = Number(x % 58n);
    result = BASE58_ALPHABET[remainder] + result;
    x = x / 58n;
  }
  for(let i = 0; i < bytes.length && bytes[i] === 0; i++){
    result = '1' + result;
  }
  return result;
}

function base58Decode(str: string): Uint8Array {
  if (str.length === 0) return new Uint8Array(0);
  let bytes = [0];
  for(let i = 0; i < str.length; i++){
    const c = str[i];
    const p = BASE58_ALPHABET.indexOf(c);
    if (p < 0) throw new Error('Invalid base58 character');
    let carry = p;
    for(let j = 0; j < bytes.length; j++){
      carry += bytes[j] * 58;
      bytes[j] = carry & 0xff;
      carry >>= 8;
    }
    while(carry > 0){
      bytes.push(carry & 0xff);
      carry >>= 8;
    }
  }
  let leadingOnes = 0;
  for(let i = 0; i < str.length && str[i] === '1'; i++){
    leadingOnes++;
  }
  const result = new Uint8Array(leadingOnes + bytes.length);
  bytes.reverse();
  result.set(bytes, leadingOnes);
  return result;
}

function base58CheckDecode(str: string): Uint8Array {
  const decoded = base58Decode(str);
  if (decoded.length < 4) throw new Error('Invalid base58check');
  const payload = decoded.slice(0, -4);
  return payload;
}

async function base58CheckEncode(payload: Uint8Array): Promise<string> {
  const hash1 = await crypto.subtle.digest('SHA-256', new Uint8Array(payload));
  const hash2 = await crypto.subtle.digest('SHA-256', hash1);
  const checksum = new Uint8Array(hash2).slice(0, 4);
  const withChecksum = new Uint8Array(payload.length + 4);
  withChecksum.set(payload);
  withChecksum.set(checksum, payload.length);
  return base58Encode(withChecksum);
}

async function sha256d(data: Uint8Array): Promise<Uint8Array> {
  const hash1 = await crypto.subtle.digest('SHA-256', new Uint8Array(data));
  const hash2 = await crypto.subtle.digest('SHA-256', hash1);
  return new Uint8Array(hash2);
}

function hexToUint8Array(hex: string): Uint8Array {
  const result = new Uint8Array(hex.length / 2);
  for(let i = 0; i < hex.length; i += 2){
    result[i / 2] = parseInt(hex.substr(i, 2), 16);
  }
  return result;
}

function uint8ArrayToHex(array: Uint8Array): string {
  return Array.from(array).map((b)=>b.toString(16).padStart(2, '0')).join('');
}

function encodeVarint(n: number): Uint8Array {
  if (n < 0xfd) {
    return new Uint8Array([n]);
  } else if (n <= 0xffff) {
    const result = new Uint8Array(3);
    result[0] = 0xfd;
    result[1] = n & 0xff;
    result[2] = n >> 8 & 0xff;
    return result;
  } else {
    throw new Error('Varint too large');
  }
}

function pushData(data: Uint8Array): Uint8Array {
  const result = new Uint8Array(1 + data.length);
  result[0] = data.length;
  result.set(data, 1);
  return result;
}

// ============ ELLIPTIC CURVE CRYPTO ============
class Point {
  x: bigint;
  y: bigint;
  
  constructor(x: bigint, y: bigint){
    this.x = x;
    this.y = y;
  }
  
  static ZERO = new Point(0n, 0n);
  static P = 0xFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFEFFFFFC2Fn;
  static N = 0xFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFEBAAEDCE6AF48A03BBFD25E8CD0364141n;
  static Gx = 0x79BE667EF9DCBBAC55A06295CE870B07029BFCDB2DCE28D959F2815B16F81798n;
  static Gy = 0x483ADA7726A3C4655DA4FBFC0E1108A8FD17B448A68554199C47D08FFB10D4B8n;
  static G = new Point(Point.Gx, Point.Gy);
  
  static mod(a: bigint, m: bigint): bigint {
    const result = a % m;
    return result >= 0n ? result : result + m;
  }
  
  static modInverse(a: bigint, m: bigint): bigint {
    if (a === 0n) return 0n;
    let lm = 1n, hm = 0n;
    let low = Point.mod(a, m), high = m;
    while(low > 1n){
      const ratio = high / low;
      const nm = hm - lm * ratio;
      const nw = high - low * ratio;
      hm = lm;
      high = low;
      lm = nm;
      low = nw;
    }
    return Point.mod(lm, m);
  }
  
  add(other: Point): Point {
    if (this.x === 0n && this.y === 0n) return other;
    if (other.x === 0n && other.y === 0n) return this;
    if (this.x === other.x) {
      if (this.y === other.y) {
        const s = Point.mod(3n * this.x * this.x * Point.modInverse(2n * this.y, Point.P), Point.P);
        const x = Point.mod(s * s - 2n * this.x, Point.P);
        const y = Point.mod(s * (this.x - x) - this.y, Point.P);
        return new Point(x, y);
      } else {
        return Point.ZERO;
      }
    } else {
      const s = Point.mod((other.y - this.y) * Point.modInverse(other.x - this.x, Point.P), Point.P);
      const x = Point.mod(s * s - this.x - other.x, Point.P);
      const y = Point.mod(s * (this.x - x) - this.y, Point.P);
      return new Point(x, y);
    }
  }
  
  multiply(scalar: bigint): Point {
    if (scalar === 0n) return Point.ZERO;
    if (scalar === 1n) return this;
    let result: Point = Point.ZERO;
    let addend: Point = this;
    while(scalar > 0n){
      if (scalar & 1n) {
        result = result.add(addend);
      }
      addend = addend.add(addend);
      scalar >>= 1n;
    }
    return result;
  }
}

function privateKeyToPublicKey(privateKeyHex: string): Uint8Array {
  const privateKeyBigInt = BigInt('0x' + privateKeyHex);
  const publicKeyPoint = Point.G.multiply(privateKeyBigInt);
  const x = publicKeyPoint.x.toString(16).padStart(64, '0');
  const y = publicKeyPoint.y.toString(16).padStart(64, '0');
  const result = new Uint8Array(65);
  result[0] = 0x04;
  result.set(hexToUint8Array(x), 1);
  result.set(hexToUint8Array(y), 33);
  return result;
}

async function publicKeyToAddress(publicKey: Uint8Array): Promise<string> {
  const sha256HashBuffer = await crypto.subtle.digest('SHA-256', new Uint8Array(publicKey));
  const sha256Hash = new Uint8Array(sha256HashBuffer);
  const hash160Array = ripemd160().update(Array.from(sha256Hash)).digest();
  const hash160 = new Uint8Array(hash160Array);
  const payload = new Uint8Array(21);
  payload[0] = 0x30;
  payload.set(hash160, 1);
  const address = await base58CheckEncode(payload);
  return address;
}

function encodeDER(r: bigint, s: bigint): Uint8Array {
  const rHex = r.toString(16).padStart(64, '0');
  const sHex = s.toString(16).padStart(64, '0');
  const rArray = Array.from(hexToUint8Array(rHex));
  const sArray = Array.from(hexToUint8Array(sHex));
  while(rArray.length > 1 && rArray[0] === 0) rArray.shift();
  while(sArray.length > 1 && sArray[0] === 0) sArray.shift();
  if (rArray[0] >= 0x80) rArray.unshift(0);
  if (sArray[0] >= 0x80) sArray.unshift(0);
  const der = [0x30, 0x00, 0x02, rArray.length, ...rArray, 0x02, sArray.length, ...sArray];
  der[1] = der.length - 2;
  return new Uint8Array(der);
}

function signECDSA(privateKeyHex: string, messageHash: Uint8Array): Uint8Array {
  const privateKey = BigInt('0x' + privateKeyHex);
  const z = BigInt('0x' + uint8ArrayToHex(messageHash));
  const k = Point.mod(z + privateKey, Point.N);
  if (k === 0n) throw new Error('Invalid k');
  const kG = Point.G.multiply(k);
  const r = Point.mod(kG.x, Point.N);
  if (r === 0n) throw new Error('Invalid r');
  const kInv = Point.modInverse(k, Point.N);
  const s = Point.mod(kInv * (z + r * privateKey), Point.N);
  if (s === 0n) throw new Error('Invalid s');
  const finalS = s > Point.N / 2n ? Point.N - s : s;
  return encodeDER(r, finalS);
}

// ============ UTXO SELECTION ============
class UTXOSelector {
  static MAX_INPUTS = 10;  // ✅ Conservative input limit
  static MAX_OUTPUTS = 200;  // ✅ Support up to 200 recipients per tx
  static DUST_THRESHOLD = 500000;
  
  static selectUTXOs(utxos: any[], totalNeeded: number) {
    if (!utxos || utxos.length === 0) {
      throw new Error('No UTXOs available for selection');
    }
    console.log(`🔍 UTXO Selection: Need ${totalNeeded} satoshis from ${utxos.length} UTXOs`);
    const totalAvailable = utxos.reduce((sum, utxo) => sum + utxo.value, 0);
    console.log(`💰 Total available: ${totalAvailable} satoshis (${(totalAvailable / 100000000).toFixed(8)} LANA)`);
    
    if (totalAvailable < totalNeeded) {
      throw new Error(
        `Insufficient total UTXO value: ${totalAvailable} < ${totalNeeded} satoshis. ` +
        `Available: ${(totalAvailable / 100000000).toFixed(8)} LANA, ` +
        `Needed: ${(totalNeeded / 100000000).toFixed(8)} LANA`
      );
    }
    
    const sortedUTXOs = [...utxos].sort((a, b) => b.value - a.value);
    const nonDustUtxos = sortedUTXOs.filter(u => u.value >= this.DUST_THRESHOLD);
    
    if (nonDustUtxos.length < sortedUTXOs.length) {
      console.log(`⚠️ Filtered out ${sortedUTXOs.length - nonDustUtxos.length} dust UTXOs`);
    }
    
    const workingSet = nonDustUtxos.length > 0 ? nonDustUtxos : sortedUTXOs;
    const selectedUTXOs = [];
    let totalSelected = 0;
    
    for (let i = 0; i < workingSet.length && selectedUTXOs.length < this.MAX_INPUTS; i++) {
      selectedUTXOs.push(workingSet[i]);
      totalSelected += workingSet[i].value;
      
      if (totalSelected >= totalNeeded) {
        console.log(`✅ Sufficient funds: ${selectedUTXOs.length} UTXOs, ${(totalSelected / 100000000).toFixed(8)} LANA`);
        return { selected: selectedUTXOs, totalValue: totalSelected };
      }
    }
    
    throw new Error(`Cannot build transaction: insufficient funds`);
  }
}

// ============ ELECTRUM CONNECTION ============
async function connectElectrum(servers: any[], maxRetries = 3) {
  for (let attempt = 0; attempt < maxRetries; attempt++) {
    for (const server of servers) {
      try {
        console.log(`🔌 Connecting to ${server.host}:${server.port} (attempt ${attempt + 1})`);
        const conn = await Deno.connect({ hostname: server.host, port: server.port });
        console.log(`✅ Connected to ${server.host}:${server.port}`);
        return conn;
      } catch (error) {
        console.error(`❌ Failed to connect to ${server.host}:${server.port}`);
      }
    }
    if (attempt < maxRetries - 1) {
      await new Promise((resolve) => setTimeout(resolve, 1000));
    }
  }
  throw new Error('Failed to connect to any Electrum server');
}

async function electrumCall(method: string, params: any[], servers: any[], timeout = 30000) {
  let conn = null;
  try {
    conn = await connectElectrum(servers);
    const request = { id: Date.now(), method, params };
    const requestData = JSON.stringify(request) + '\n';
    console.log(`📤 Electrum ${method}:`, params);
    
    const timeoutPromise = new Promise((_, reject) => {
      setTimeout(() => reject(new Error(`Electrum call timeout after ${timeout}ms`)), timeout);
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
      
      if (!responseText) throw new Error('No response from Electrum server');
      responseText = responseText.trim();
      
      const response = JSON.parse(responseText);
      if (response.error) throw new Error(`Electrum error: ${JSON.stringify(response.error)}`);
      return response.result;
    })();
    
    return await Promise.race([callPromise, timeoutPromise]);
  } finally {
    if (conn) {
      try {
        conn.close();
      } catch (e) {
        console.warn('Warning: Failed to close connection');
      }
    }
  }
}

function parseScriptPubkeyFromRawTx(rawHex: string, voutIndex: number): Uint8Array {
  const tx = hexToUint8Array(rawHex);
  let cursor = 0;
  
  const readVarint = () => {
    const first = tx[cursor++];
    if (first < 0xfd) return first;
    if (first === 0xfd) {
      const value = tx[cursor] | tx[cursor + 1] << 8;
      cursor += 2;
      return value;
    }
    throw new Error('Varint too large');
  };
  
  cursor += 4;
  cursor += 4;
  const vinCount = readVarint();
  
  for (let i = 0; i < vinCount; i++) {
    cursor += 32;
    cursor += 4;
    const scriptLen = readVarint();
    cursor += scriptLen;
    cursor += 4;
  }
  
  const voutCount = readVarint();
  
  if (voutIndex >= voutCount) {
    throw new Error(`vout index ${voutIndex} >= output count ${voutCount}`);
  }
  
  for (let i = 0; i < voutCount; i++) {
    cursor += 8;
    const scriptLen = readVarint();
    const script = tx.slice(cursor, cursor + scriptLen);
    if (i === voutIndex) {
      return script;
    }
    cursor += scriptLen;
  }
  
  throw new Error(`vout index ${voutIndex} not found`);
}

// ============ TRANSACTION BUILDING ============
async function buildSignedTx(
  selectedUTXOs: any[],
  privateKeyWIF: string,
  recipients: any[],
  fee: number,
  changeAddress: string,
  servers: any[]
) {
  console.log(`🔧 Building multi-output transaction: ${recipients.length} outputs, ${selectedUTXOs.length} inputs`);
  
  const privateKeyBytes = base58CheckDecode(privateKeyWIF);
  const privateKeyHex = uint8ArrayToHex(privateKeyBytes.slice(1));
  const publicKey = privateKeyToPublicKey(privateKeyHex);
  
  const totalAmount = recipients.reduce((sum: number, recipient: any) => sum + recipient.amount, 0);
  const totalValue = selectedUTXOs.reduce((sum: number, utxo: any) => sum + utxo.value, 0);
  
  // Build recipient outputs
  const outputs = [];
  for (const recipient of recipients) {
    // ✅ CRITICAL FIX: Take exactly 20 bytes (hash160) - slice(1, 21) to skip version byte
    const recipientHash = base58CheckDecode(recipient.address).slice(1, 21);
    if (recipientHash.length !== 20) {
      throw new Error(`Invalid address hash length: ${recipientHash.length} bytes for ${recipient.address}`);
    }
    const recipientScript = new Uint8Array([0x76, 0xa9, 0x14, ...recipientHash, 0x88, 0xac]);
    const recipientValueBytes = new Uint8Array(8);
    new DataView(recipientValueBytes.buffer).setBigUint64(0, BigInt(recipient.amount), true);
    const recipientOut = new Uint8Array([
      ...recipientValueBytes,
      ...encodeVarint(recipientScript.length),
      ...recipientScript
    ]);
    outputs.push(recipientOut);
  }
  
  // Calculate change
  const changeAmount = totalValue - totalAmount - fee;
  let outputCount = recipients.length;
  
  if (changeAmount > 1000) {
    // ✅ CRITICAL FIX: Take exactly 20 bytes (hash160) - slice(1, 21) to skip version byte
    const changeHash = base58CheckDecode(changeAddress).slice(1, 21);
    if (changeHash.length !== 20) {
      throw new Error(`Invalid change address hash length: ${changeHash.length} bytes for ${changeAddress}`);
    }
    const changeScript = new Uint8Array([0x76, 0xa9, 0x14, ...changeHash, 0x88, 0xac]);
    const changeValueBytes = new Uint8Array(8);
    new DataView(changeValueBytes.buffer).setBigUint64(0, BigInt(changeAmount), true);
    const changeOut = new Uint8Array([
      ...changeValueBytes,
      ...encodeVarint(changeScript.length),
      ...changeScript
    ]);
    outputs.push(changeOut);
    outputCount++;
    console.log(`✅ Change: ${(changeAmount / 100000000).toFixed(8)} LANA`);
  }
  
  const version = new Uint8Array([0x01, 0x00, 0x00, 0x00]);
  const nTime = new Uint8Array(4);
  const timestamp = Math.floor(Date.now() / 1000);
  new DataView(nTime.buffer).setUint32(0, timestamp, true);
  const locktime = new Uint8Array([0x00, 0x00, 0x00, 0x00]);
  const hashType = new Uint8Array([0x01, 0x00, 0x00, 0x00]);
  
  // Fetch all scriptPubkeys first (use longer timeout for old transactions)
  const scriptPubkeys: Uint8Array[] = [];
  for (let i = 0; i < selectedUTXOs.length; i++) {
    const utxo = selectedUTXOs[i];
    console.log(`📥 Fetching transaction ${i + 1}/${selectedUTXOs.length}: ${utxo.tx_hash}`);
    const rawTx = await electrumCall('blockchain.transaction.get', [utxo.tx_hash], servers, 60000); // 60s timeout
    const scriptPubkey = parseScriptPubkeyFromRawTx(rawTx, utxo.tx_pos);
    scriptPubkeys.push(scriptPubkey);
  }
  
  // Sign each input
  const signedInputs = [];
  for (let i = 0; i < selectedUTXOs.length; i++) {
    const utxo = selectedUTXOs[i];
    
    // Build ALL inputs for preimage (SIGHASH_ALL)
    const preimageInputs: Uint8Array[] = [];
    for (let j = 0; j < selectedUTXOs.length; j++) {
      const uj = selectedUTXOs[j];
      const txidJ = hexToUint8Array(uj.tx_hash).reverse();
      const voutJ = new Uint8Array(4);
      new DataView(voutJ.buffer).setUint32(0, uj.tx_pos, true);
      
      const scriptForJ = (j === i) ? scriptPubkeys[j] : new Uint8Array(0);
      
      const inputJ = new Uint8Array([
        ...txidJ,
        ...voutJ,
        ...encodeVarint(scriptForJ.length),
        ...scriptForJ,
        0xff, 0xff, 0xff, 0xff
      ]);
      preimageInputs.push(inputJ);
    }
    
    const allPreimageInputs = preimageInputs.reduce((acc, cur) => {
      const out = new Uint8Array(acc.length + cur.length);
      out.set(acc);
      out.set(cur, acc.length);
      return out;
    }, new Uint8Array(0));
    
    const allOutputs = new Uint8Array(outputs.reduce((total, output) => total + output.length, 0));
    let offset = 0;
    for (const output of outputs) {
      allOutputs.set(output, offset);
      offset += output.length;
    }
    
    const preimage = new Uint8Array([
      ...version,
      ...nTime,
      ...encodeVarint(selectedUTXOs.length),
      ...allPreimageInputs,
      ...encodeVarint(outputCount),
      ...allOutputs,
      ...locktime,
      ...hashType
    ]);
    
    const sighash = await sha256d(preimage);
    const signature = signECDSA(privateKeyHex, sighash);
    const signatureWithHashType = new Uint8Array([...signature, 0x01]);
    const scriptSig = new Uint8Array([
      ...pushData(signatureWithHashType),
      ...pushData(publicKey)
    ]);
    
    const txid = hexToUint8Array(utxo.tx_hash).reverse();
    const voutBytes = new Uint8Array(4);
    new DataView(voutBytes.buffer).setUint32(0, utxo.tx_pos, true);
    
    const signedInput = new Uint8Array([
      ...txid,
      ...voutBytes,
      ...encodeVarint(scriptSig.length),
      ...scriptSig,
      0xff, 0xff, 0xff, 0xff
    ]);
    
    signedInputs.push(signedInput);
  }
  
  const allInputs = new Uint8Array(signedInputs.reduce((total, input) => total + input.length, 0));
  let offset = 0;
  for (const input of signedInputs) {
    allInputs.set(input, offset);
    offset += input.length;
  }
  
  const allOutputsBytes = new Uint8Array(outputs.reduce((total, output) => total + output.length, 0));
  offset = 0;
  for (const output of outputs) {
    allOutputsBytes.set(output, offset);
    offset += output.length;
  }
  
  const finalTx = new Uint8Array([
    ...version,
    ...nTime,
    ...encodeVarint(selectedUTXOs.length),
    ...allInputs,
    ...encodeVarint(outputCount),
    ...allOutputsBytes,
    ...locktime
  ]);
  
  const finalTxHex = uint8ArrayToHex(finalTx);
  console.log(`✅ Transaction built: ${finalTxHex.length / 2} bytes`);
  
  return finalTxHex;
}

// ============ BLOCK-BASED UTXO REUSE PROTECTION ============
async function checkBlockEligibility(
  senderPubkey: string,
  currentBlockHeight: number,
  supabaseClient: any
): Promise<{ canSend: boolean; lastBlock?: number; reason?: string }> {
  try {
    // Query last transaction from this sender
    const { data: lastTx, error } = await supabaseClient
      .from('transaction_history')
      .select('block_height, block_time, created_at')
      .eq('sender_pubkey', senderPubkey)
      .order('block_height', { ascending: false })
      .limit(1)
      .maybeSingle();

    if (error) {
      console.error('❌ Error querying transaction history:', error);
      return { canSend: true }; // Allow send if DB query fails (fail-open)
    }

    if (!lastTx) {
      console.log('✅ No previous transactions found - OK to send');
      return { canSend: true };
    }

    const lastBlockHeight = lastTx.block_height;
    console.log(`📊 Last transaction: Block ${lastBlockHeight}, Current: Block ${currentBlockHeight}`);

    if (currentBlockHeight <= lastBlockHeight) {
      console.warn(`⚠️ BLOCKED: Cannot send - last TX was in block ${lastBlockHeight}, current is ${currentBlockHeight}`);
      return {
        canSend: false,
        lastBlock: lastBlockHeight,
        reason: `Last transaction was sent in block ${lastBlockHeight}. Current block is ${currentBlockHeight}. Wait for block ${lastBlockHeight + 1} or higher.`
      };
    }

    console.log(`✅ OK to send: Current block ${currentBlockHeight} > Last block ${lastBlockHeight}`);
    return { canSend: true, lastBlock: lastBlockHeight };
  } catch (error) {
    console.error('❌ Exception in checkBlockEligibility:', error);
    return { canSend: true }; // Fail-open: allow send if check fails
  }
}

// Nostr confirmations will be handled client-side after successful broadcast

// ============ MAIN HANDLER ============
serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }
  
  try {
    console.log('🚀 Starting batch LASH payment...');
    const { privateKeyWIF, senderPrivkey, senderPubkey, recipients, changeAddress, electrum_servers } = await req.json();
    
    if (!privateKeyWIF || !senderPrivkey || !senderPubkey || !recipients || !changeAddress || recipients.length === 0) {
      throw new Error('Missing required parameters');
    }
    
    console.log(`📊 Processing ${recipients.length} LASHes`);
    
    // Initialize Supabase client
    const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
    const supabaseKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
    const supabaseClient = createClient(supabaseUrl, supabaseKey);
    
    // Group recipients by address and sum amounts
    const recipientMap = new Map<string, {
      address: string,
      totalAmount: number,
      pubkeys: string[],
      eventIds: string[],
      lashIds: string[]
    }>();
    
    for (const r of recipients) {
      const existing = recipientMap.get(r.address);
      if (existing) {
        existing.totalAmount += r.amount;
        existing.pubkeys.push(r.recipientPubkey);
        existing.eventIds.push(r.eventId);
        existing.lashIds.push(r.lashId);
      } else {
        recipientMap.set(r.address, {
          address: r.address,
          totalAmount: r.amount,
          pubkeys: [r.recipientPubkey],
          eventIds: [r.eventId],
          lashIds: [r.lashId]
        });
      }
    }
    
    const optimizedRecipients = Array.from(recipientMap.values()).map(r => ({
      address: r.address,
      amount: r.totalAmount
    }));
    
    // Create vout mapping: address → vout_index
    const voutMap = new Map<string, number>();
    optimizedRecipients.forEach((r, index) => {
      voutMap.set(r.address, index);
    });
    
    // Expand original recipients with vout, fromWallet, toWallet
    const expandedRecipients = recipients.map((r: any) => ({
      lashId: r.lashId,
      eventId: r.eventId,
      recipientPubkey: r.recipientPubkey,
      amount: r.amount,
      fromWallet: changeAddress, // sender wallet
      toWallet: r.address, // recipient wallet
      vout: voutMap.get(r.address)!
    }));
    
    // ✅ Check MAX_OUTPUTS limit
    if (optimizedRecipients.length > UTXOSelector.MAX_OUTPUTS) {
      console.error(`❌ Too many unique recipients: ${optimizedRecipients.length} > ${UTXOSelector.MAX_OUTPUTS}`);
      return new Response(
        JSON.stringify({ 
          success: false, 
          error: `Transaction limited to ${UTXOSelector.MAX_OUTPUTS} unique recipients. You have ${optimizedRecipients.length}. Many users will be grouped together automatically.` 
        }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }
    
    console.log(`💡 Optimized to ${optimizedRecipients.length} unique addresses (from ${recipients.length} LASHes)`);
    
    const servers = electrum_servers && electrum_servers.length > 0
      ? electrum_servers
      : [
          { host: "electrum1.lanacoin.com", port: 5097 },
          { host: "electrum2.lanacoin.com", port: 5097 }
        ];
    
    // ✅ Fetch current block height & time BEFORE UTXO selection
    console.log('📊 Fetching current block info...');
    const headerInfo = await electrumCall('blockchain.headers.subscribe', [], servers);
    const currentBlockHeight = headerInfo?.height || headerInfo?.block_height || 0;
    const currentBlockTime = headerInfo?.timestamp || Math.floor(Date.now() / 1000);
    console.log(`📦 Current Block: ${currentBlockHeight}, Time: ${currentBlockTime}`);

    // ✅ Check if we can send in this block
    const eligibility = await checkBlockEligibility(senderPubkey, currentBlockHeight, supabaseClient);
    if (!eligibility.canSend) {
      return new Response(
        JSON.stringify({
          success: false,
          error: eligibility.reason,
          canSend: false,
          lastBlock: eligibility.lastBlock,
          currentBlock: currentBlockHeight,
          blockTime: currentBlockTime
        }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }
    
    // Get UTXOs
    const utxos = await electrumCall('blockchain.address.listunspent', [changeAddress], servers);
    if (!utxos || utxos.length === 0) throw new Error('No UTXOs available');
    
    const totalAmountSatoshis = optimizedRecipients.reduce((sum: number, r: any) => sum + r.amount, 0);
    console.log(`💰 Total to send: ${(totalAmountSatoshis / 100000000).toFixed(8)} LANA`);
    
    // Select UTXOs iteratively to account for fees
    let initialSelection = UTXOSelector.selectUTXOs(utxos, totalAmountSatoshis);
    let selectedUTXOs = initialSelection.selected;
    let totalSelected = initialSelection.totalValue;
    
    const actualOutputCount = optimizedRecipients.length + 1;
    let baseFee = (selectedUTXOs.length * 180 + actualOutputCount * 34 + 10) * 100;
    let fee = Math.floor(baseFee * 1.5);
    
    let iterations = 0;
    const maxIterations = 10;
    
    while (totalSelected < totalAmountSatoshis + fee && selectedUTXOs.length < utxos.length && iterations < maxIterations) {
      iterations++;
      const needed = totalAmountSatoshis + fee;
      const reSelection = UTXOSelector.selectUTXOs(utxos, needed);
      selectedUTXOs = reSelection.selected;
      totalSelected = reSelection.totalValue;
      baseFee = (selectedUTXOs.length * 180 + actualOutputCount * 34 + 10) * 100;
      fee = Math.floor(baseFee * 1.5);
    }
    
    if (totalSelected < totalAmountSatoshis + fee) {
      throw new Error(`Insufficient funds: need ${totalAmountSatoshis + fee}, have ${totalSelected}`);
    }
    
    console.log(`💸 Transaction: Amount=${totalAmountSatoshis}, Fee=${fee}, Change=${totalSelected - totalAmountSatoshis - fee}`);
    
    // Build and sign transaction
    const signedTx = await buildSignedTx(selectedUTXOs, privateKeyWIF, optimizedRecipients, fee, changeAddress, servers);
    
    // Broadcast transaction
    console.log('🚀 Broadcasting transaction...');
    const broadcastResult = await electrumCall('blockchain.transaction.broadcast', [signedTx], servers, 45000);
    
    if (!broadcastResult) throw new Error('Transaction broadcast failed');
    
    const resultStr = String(broadcastResult).trim();
    if (resultStr.includes('rejected') || resultStr.includes('error') || resultStr.includes('failed')) {
      throw new Error(`Transaction broadcast failed: ${resultStr}`);
    }
    
    if (!/^[a-fA-F0-9]{64}$/.test(resultStr)) {
      throw new Error(`Invalid transaction ID format: ${resultStr}`);
    }
    
    const txid = resultStr;
    console.log('✅ Transaction broadcast successful:', txid);
    
    // ✅ Save transaction to history
    try {
      const usedOutpoints = selectedUTXOs.map(utxo => `${utxo.tx_hash}:${utxo.tx_pos}`);
      
      const { error: dbError } = await supabaseClient
        .from('transaction_history')
        .insert({
          txid,
          sender_pubkey: senderPubkey,
          block_height: currentBlockHeight,
          block_time: currentBlockTime,
          used_utxos: usedOutpoints
        });

      if (dbError) {
        console.error('⚠️ Failed to save transaction history:', dbError);
        // Don't fail the request - transaction was already broadcast successfully
      } else {
        console.log(`✅ Transaction saved to history: Block ${currentBlockHeight}`);
      }
    } catch (error) {
      console.error('⚠️ Exception saving transaction history:', error);
      // Don't fail the request
    }
    
    // Return success - client will handle Nostr confirmations
    return new Response(
      JSON.stringify({ 
        success: true, 
        txid,
        blockHeight: currentBlockHeight,
        blockTime: currentBlockTime,
        totalRecipients: recipients.length,
        uniqueAddresses: optimizedRecipients.length,
        totalAmount: totalAmountSatoshis,
        fee,
        recipients: expandedRecipients // ✅ Expanded with vout, fromWallet, toWallet
      }),
      {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' }
      }
    );
  } catch (error) {
    console.error('❌ Batch send error:', error);
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
