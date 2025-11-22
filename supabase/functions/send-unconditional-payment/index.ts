import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { ripemd160 } from "https://esm.sh/hash.js@1.1.7";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type'
};

// Base58 alphabet
const BASE58_ALPHABET = '123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz';

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

class UTXOSelector {
  static MAX_INPUTS = 500;
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
    
    console.log('🏆 Top 10 largest UTXOs:');
    sortedUTXOs.slice(0, 10).forEach((utxo, i) => {
      console.log(`  ${i + 1}. ${utxo.value} satoshis (${(utxo.value / 100000000).toFixed(8)} LANA) - ${utxo.tx_hash}:${utxo.tx_pos}`);
    });
    
    const nonDustUtxos = sortedUTXOs.filter(u => u.value >= this.DUST_THRESHOLD);
    
    if (nonDustUtxos.length < sortedUTXOs.length) {
      console.log(`⚠️ Filtered out ${sortedUTXOs.length - nonDustUtxos.length} dust UTXOs (< ${this.DUST_THRESHOLD} satoshis = ${(this.DUST_THRESHOLD / 100000000).toFixed(8)} LANA)`);
    }
    
    const workingSet = nonDustUtxos.length > 0 ? nonDustUtxos : sortedUTXOs;
    
    console.log(`📦 Selecting minimum UTXOs needed for ${(totalNeeded / 100000000).toFixed(8)} LANA...`);
    
    const selectedUTXOs = [];
    let totalSelected = 0;
    
    for (let i = 0; i < workingSet.length && selectedUTXOs.length < this.MAX_INPUTS; i++) {
      selectedUTXOs.push(workingSet[i]);
      totalSelected += workingSet[i].value;
      
      if (totalSelected >= totalNeeded) {
        console.log(
          `✅ Sufficient funds reached with ${selectedUTXOs.length} UTXOs: ` +
          `total: ${(totalSelected / 100000000).toFixed(8)} LANA`
        );
        return { selected: selectedUTXOs, totalValue: totalSelected };
      }
    }
    
    if (nonDustUtxos.length !== sortedUTXOs.length) {
      console.log('⚠️ Including dust UTXOs to meet target...');
      for (const utxo of sortedUTXOs) {
        if (selectedUTXOs.some(s => s.tx_hash === utxo.tx_hash && s.tx_pos === utxo.tx_pos)) continue;
        if (selectedUTXOs.length >= this.MAX_INPUTS) break;
        
        selectedUTXOs.push(utxo);
        totalSelected += utxo.value;
        
        if (totalSelected >= totalNeeded) {
          console.log(
            `✅ Solution with dust UTXOs: ${selectedUTXOs.length} inputs, ` +
            `total: ${(totalSelected / 100000000).toFixed(8)} LANA`
          );
          return { selected: selectedUTXOs, totalValue: totalSelected };
        }
      }
    }
    
    throw new Error(
      `Cannot build transaction: Need ${(totalNeeded / 100000000).toFixed(8)} LANA but ` +
      `only ${(totalSelected / 100000000).toFixed(8)} LANA available in ${selectedUTXOs.length} UTXOs. ` +
      `Total wallet balance: ${(totalAvailable / 100000000).toFixed(8)} LANA. ` +
      `Recommendation: Consolidate UTXOs first by sending all funds to yourself.`
    );
  }
}

async function connectElectrum(servers: any[], maxRetries = 3) {
  for (let attempt = 0; attempt < maxRetries; attempt++) {
    for (const server of servers) {
      try {
        console.log(`🔌 Connecting to ${server.host}:${server.port} (attempt ${attempt + 1})`);
        const conn = await Deno.connect({ hostname: server.host, port: server.port });
        console.log(`✅ Connected to ${server.host}:${server.port}`);
        return conn;
      } catch (error) {
        const errorMessage = error instanceof Error ? error.message : 'Unknown connection error';
        console.error(`❌ Failed to connect to ${server.host}:${server.port}:`, errorMessage);
      }
    }
    if (attempt < maxRetries - 1) {
      console.log(`⏳ Waiting 1 second before retry...`);
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
      console.log(`📥 Electrum response (${responseText.length} bytes):`, responseText.substring(0, 500));
      
      const response = JSON.parse(responseText);
      if (response.error) throw new Error(`Electrum error: ${JSON.stringify(response.error)}`);
      return response.result;
    })();
    
    return await Promise.race([callPromise, timeoutPromise]);
  } catch (error) {
    console.error(`❌ Electrum call error for ${method}:`, error);
    throw error;
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
    if (first === 0xfe) {
      const value = tx[cursor] | tx[cursor + 1] << 8 | tx[cursor + 2] << 16 | tx[cursor + 3] << 24;
      cursor += 4;
      return value;
    }
    throw new Error('Varint too large');
  };
  
  cursor += 4;
  cursor += 4;
  const vinCount = readVarint();
  console.log(`📥 Transaction has ${vinCount} inputs`);
  
  for (let i = 0; i < vinCount; i++) {
    cursor += 32;
    cursor += 4;
    const scriptLen = readVarint();
    cursor += scriptLen;
    cursor += 4;
  }
  
  const voutCount = readVarint();
  console.log(`📤 Transaction has ${voutCount} outputs, looking for index ${voutIndex}`);
  
  if (voutIndex >= voutCount) {
    throw new Error(`vout index ${voutIndex} >= output count ${voutCount}`);
  }
  
  for (let i = 0; i < voutCount; i++) {
    cursor += 8;
    const scriptLen = readVarint();
    const script = tx.slice(cursor, cursor + scriptLen);
    if (i === voutIndex) {
      console.log(`✅ Found output ${voutIndex} with script length ${scriptLen}`);
      return script;
    }
    cursor += scriptLen;
  }
  
  throw new Error(`vout index ${voutIndex} not found in ${voutCount} outputs`);
}

async function buildSignedTx(
  selectedUTXOs: any[],
  privateKeyWIF: string,
  recipients: any[],
  fee: number,
  changeAddress: string,
  servers: any[]
) {
  console.log('🔧 Building multi-output transaction with enhanced validation...');
  console.log(`📊 Recipients: ${recipients.length} outputs`);
  console.log(`📊 Using ${selectedUTXOs.length} pre-selected UTXOs`);
  
  try {
    if (!selectedUTXOs || selectedUTXOs.length === 0) throw new Error('No UTXOs provided for transaction building');
    if (recipients.length === 0) throw new Error('No recipients provided');
    
    const totalAmount = recipients.reduce((sum: number, recipient: any) => sum + recipient.amount, 0);
    if (totalAmount <= 0) throw new Error('Invalid total amount: must be positive');
    if (fee <= 0) throw new Error('Invalid fee: must be positive');
    
    const totalValue = selectedUTXOs.reduce((sum: number, utxo: any) => sum + utxo.value, 0);
    console.log(`💰 Total input value from ${selectedUTXOs.length} UTXOs: ${totalValue} satoshis (${(totalValue / 100000000).toFixed(8)} LANA)`);
    console.log(`💸 Transaction breakdown: Amount=${totalAmount}, Fee=${fee}, Change=${totalValue - totalAmount - fee}`);
    
    const privateKeyBytes = base58CheckDecode(privateKeyWIF);
    const privateKeyHex = uint8ArrayToHex(privateKeyBytes.slice(1));
    console.log('🔑 Private key decoded successfully');
    
    const publicKey = privateKeyToPublicKey(privateKeyHex);
    console.log('🔑 Public key generated successfully');
    
    const outputs = [];
    for (const recipient of recipients) {
      const recipientHash = base58CheckDecode(recipient.address).slice(1);
      const recipientScript = new Uint8Array([0x76, 0xa9, 0x14, ...recipientHash, 0x88, 0xac]);
      const recipientValueBytes = new Uint8Array(8);
      new DataView(recipientValueBytes.buffer).setBigUint64(0, BigInt(recipient.amount), true);
      const recipientOut = new Uint8Array([
        ...recipientValueBytes,
        ...encodeVarint(recipientScript.length),
        ...recipientScript
      ]);
      outputs.push(recipientOut);
      console.log(`📤 Output ${outputs.length}: ${recipient.address} = ${(recipient.amount / 100000000).toFixed(8)} LANA`);
    }
    
    const changeAmount = totalValue - totalAmount - fee;
    let outputCount = recipients.length;
    
    if (changeAmount > 1000) {
      const changeHash = base58CheckDecode(changeAddress).slice(1);
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
      console.log(`✅ Change output added: ${(changeAmount / 100000000).toFixed(8)} LANA`);
    } else if (changeAmount > 0) {
      console.log(`⚠️ Change amount too small (${changeAmount}), adding to fee`);
    }
    
    const version = new Uint8Array([0x01, 0x00, 0x00, 0x00]);
    const nTime = new Uint8Array(4);
    const timestamp = Math.floor(Date.now() / 1000);
    new DataView(nTime.buffer).setUint32(0, timestamp, true);
    const locktime = new Uint8Array([0x00, 0x00, 0x00, 0x00]);
    const hashType = new Uint8Array([0x01, 0x00, 0x00, 0x00]);
    
    const signedInputs = [];
    console.log(`🔄 Starting to process ${selectedUTXOs.length} UTXOs...`);
    
    const scriptPubkeys: Uint8Array[] = [];
    for (let i = 0; i < selectedUTXOs.length; i++) {
      const utxo = selectedUTXOs[i];
      console.log(`🔍 Fetching scriptPubKey for UTXO ${i + 1}/${selectedUTXOs.length}: ${utxo.tx_hash}:${utxo.tx_pos}`);
      const rawTx = await electrumCall('blockchain.transaction.get', [utxo.tx_hash], servers);
      const scriptPubkey = parseScriptPubkeyFromRawTx(rawTx, utxo.tx_pos);
      scriptPubkeys.push(scriptPubkey);
    }
    
    for (let i = 0; i < selectedUTXOs.length; i++) {
      const utxo = selectedUTXOs[i];
      console.log(`🔍 Processing UTXO ${i + 1}/${selectedUTXOs.length}: ${utxo.tx_hash}:${utxo.tx_pos}`);
      
      try {
        console.log(`📜 Script pubkey for input ${i + 1}: ${scriptPubkeys[i].length} bytes`);
        
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
        console.log(`🔑 Sighash computed for input ${i + 1}`);
        
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
        console.log(`✅ Input ${i + 1} signed successfully`);
      } catch (utxoError) {
        console.error(`❌ Failed to process UTXO ${i + 1}:`, utxoError);
        throw new Error(
          `Failed to process UTXO ${i + 1}/${selectedUTXOs.length}: ${
            utxoError instanceof Error ? utxoError.message : 'Unknown error'
          }`
        );
      }
    }
    
    console.log(`✅✅✅ ALL ${selectedUTXOs.length} UTXOs PROCESSED SUCCESSFULLY!`);
    console.log(`🔨 Building final transaction from ${signedInputs.length} signed inputs...`);
    
    const allInputs = new Uint8Array(signedInputs.reduce((total, input) => total + input.length, 0));
    let offset = 0;
    for (const input of signedInputs) {
      allInputs.set(input, offset);
      offset += input.length;
    }
    
    const allOutputs = new Uint8Array(outputs.reduce((total, output) => total + output.length, 0));
    offset = 0;
    for (const output of outputs) {
      allOutputs.set(output, offset);
      offset += output.length;
    }
    
    console.log(`📦 Assembling final transaction: ${selectedUTXOs.length} inputs, ${outputCount} outputs...`);
    
    const finalTx = new Uint8Array([
      ...version,
      ...nTime,
      ...encodeVarint(selectedUTXOs.length),
      ...allInputs,
      ...encodeVarint(outputCount),
      ...allOutputs,
      ...locktime
    ]);
    
    console.log(`✅ Final transaction assembled successfully!`);
    const finalTxHex = uint8ArrayToHex(finalTx);
    console.log(`🎯 Final transaction built: ${finalTxHex.length} chars, ${selectedUTXOs.length} inputs, ${outputCount} outputs`);
    console.log(`📊 Transaction size: ${finalTxHex.length / 2} bytes`);
    
    return finalTxHex;
  } catch (error) {
    console.error('❌ Transaction building error:', error);
    const errorMessage = error instanceof Error ? error.message : 'Unknown transaction error';
    throw new Error(`Failed to build transaction: ${errorMessage}`);
  }
}

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }
  
  try {
    console.log('🚀 Starting LANA multi-output transaction...');
    const { sender_address, recipients, private_key, electrum_servers } = await req.json();
    
    console.log('📋 Transaction parameters:', {
      sender_address,
      recipient_count: recipients?.length || 0,
      hasPrivateKey: !!private_key
    });
    
    if (!sender_address || !recipients || !private_key || recipients.length === 0) {
      throw new Error('Missing required parameters');
    }
    
    const recipientsInSatoshis = recipients.map((recipient: any) => {
      if (!recipient.address || typeof recipient.amount !== 'number') {
        throw new Error('Invalid recipient format: must have address and amount');
      }
      return {
        address: recipient.address,
        amount: Math.round(recipient.amount * 100000000)
      };
    });
    
    console.log(`📦 Processing transaction with ${recipientsInSatoshis.length} outputs:`);
    recipientsInSatoshis.forEach((r: any, i: number) => {
      console.log(`  ${i + 1}. ${r.address}: ${(r.amount / 100000000).toFixed(8)} LANA`);
    });
    
    try {
      const privateKeyBytes = base58CheckDecode(private_key);
      const privateKeyHex = uint8ArrayToHex(privateKeyBytes.slice(1));
      const generatedPubKey = privateKeyToPublicKey(privateKeyHex);
      const expectedAddress = await publicKeyToAddress(generatedPubKey);
      
      if (expectedAddress !== sender_address) {
        throw new Error(
          `Private key does not match sender address. Expected: ${expectedAddress}, Got: ${sender_address}`
        );
      }
      
      console.log('✅ Private key validation passed');
    } catch (error) {
      console.error('❌ Private key validation failed:', error);
      throw error;
    }
    
    const servers = electrum_servers && electrum_servers.length > 0
      ? electrum_servers
      : [
          { host: "electrum1.lanacoin.com", port: 5097 },
          { host: "electrum2.lanacoin.com", port: 5097 }
        ];
    
    console.log(`⚙️ Using Electrum servers:`, servers);
    
    const utxos = await electrumCall('blockchain.address.listunspent', [sender_address], servers);
    if (!utxos || utxos.length === 0) throw new Error('No UTXOs available');
    console.log(`📦 Found ${utxos.length} UTXOs`);
    
    const totalAmountSatoshis = recipientsInSatoshis.reduce((sum: number, r: any) => sum + r.amount, 0);
    console.log(`💰 Total to send: ${totalAmountSatoshis} satoshis (${(totalAmountSatoshis / 100000000).toFixed(8)} LANA)`);
    
    const totalAvailable = utxos.reduce((sum: number, utxo: any) => sum + utxo.value, 0);
    console.log(`💰 Total available: ${totalAvailable} satoshis (${(totalAvailable / 100000000).toFixed(8)} LANA)`);
    
    let initialSelection = UTXOSelector.selectUTXOs(utxos, totalAmountSatoshis);
    let selectedUTXOs = initialSelection.selected;
    let totalSelected = initialSelection.totalValue;
    
    console.log(`📊 Initial selection: ${selectedUTXOs.length} UTXOs with ${totalSelected} satoshis`);
    
    const actualOutputCount = recipientsInSatoshis.length + 1;
    let baseFee = (selectedUTXOs.length * 180 + actualOutputCount * 34 + 10) * 100;
    let fee = Math.floor(baseFee * 1.5);
    
    console.log(`💸 Calculated fee: ${fee} satoshis (base: ${baseFee}, 50% buffer) for ${selectedUTXOs.length} inputs, ${actualOutputCount} outputs`);
    
    let iterations = 0;
    const maxIterations = 10;
    
    while (totalSelected < totalAmountSatoshis + fee && selectedUTXOs.length < utxos.length && iterations < maxIterations) {
      iterations++;
      const needed = totalAmountSatoshis + fee;
      console.log(`🔄 Iteration ${iterations}: Need ${needed} satoshis, have ${totalSelected} satoshis, reselecting...`);
      
      const reSelection = UTXOSelector.selectUTXOs(utxos, needed);
      selectedUTXOs = reSelection.selected;
      totalSelected = reSelection.totalValue;
      
      baseFee = (selectedUTXOs.length * 180 + actualOutputCount * 34 + 10) * 100;
      fee = Math.floor(baseFee * 1.5);
      
      console.log(`   → Selected ${selectedUTXOs.length} UTXOs, total: ${totalSelected} satoshis, new fee: ${fee} satoshis`);
    }
    
    if (totalSelected < totalAmountSatoshis + fee) {
      throw new Error(`Insufficient funds: need ${totalAmountSatoshis + fee} satoshis, have ${totalSelected} satoshis`);
    }
    
    console.log(`✅ Final selection: ${selectedUTXOs.length} UTXOs with ${totalSelected} satoshis`);
    console.log(`💸 Transaction breakdown: Amount=${totalAmountSatoshis}, Fee=${fee}, Change=${totalSelected - totalAmountSatoshis - fee}`);
    
    const signedTx = await buildSignedTx(selectedUTXOs, private_key, recipientsInSatoshis, fee, sender_address, servers);
    console.log('✍️ Transaction signed successfully');
    
    console.log('🚀 Broadcasting transaction...');
    const broadcastResult = await electrumCall('blockchain.transaction.broadcast', [signedTx], servers, 45000);
    
    if (!broadcastResult) throw new Error('Transaction broadcast failed - no result from Electrum server');
    
    let resultStr = typeof broadcastResult === 'string' ? broadcastResult : String(broadcastResult);
    
    if (
      resultStr.includes('TX rejected') ||
      resultStr.includes('code') ||
      resultStr.includes('-22') ||
      resultStr.includes('error') ||
      resultStr.includes('Error') ||
      resultStr.includes('failed') ||
      resultStr.includes('Failed')
    ) {
      throw new Error(`Transaction broadcast failed: ${resultStr}`);
    }
    
    const txid = resultStr.trim();
    if (!/^[a-fA-F0-9]{64}$/.test(txid)) {
      throw new Error(`Invalid transaction ID format: ${txid}`);
    }
    
    console.log('✅ Transaction broadcast successful:', txid);
    
    return new Response(
      JSON.stringify({ 
        success: true, 
        txid, 
        total_amount: totalAmountSatoshis, 
        fee,
        output_count: recipientsInSatoshis.length
      }),
      {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' }
      }
    );
  } catch (error) {
    console.error('❌ Transaction error:', error);
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
