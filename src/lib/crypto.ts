import elliptic from 'elliptic';
import CryptoJS from 'crypto-js';
import { bech32 } from 'bech32';

const ec = new elliptic.ec('secp256k1');

// Convert hexadecimal string to byte array
function hexToBytes(hex: string) {
  const bytes = new Uint8Array(hex.match(/.{2}/g)!.map(byte => parseInt(byte, 16)));
  return bytes as Uint8Array;
}

// Convert byte array to hexadecimal string
function bytesToHex(bytes: Uint8Array): string {
  return Array.from(bytes, b => b.toString(16).padStart(2, '0')).join('');
}

// SHA-256 hash function using Web Crypto API
async function sha256(hex: string): Promise<string> {
  const buffer = hexToBytes(hex);
  // Create a proper ArrayBuffer from Uint8Array
  const arrayBuffer = buffer.buffer.slice(buffer.byteOffset, buffer.byteOffset + buffer.byteLength) as ArrayBuffer;
  const hashBuffer = await crypto.subtle.digest("SHA-256", arrayBuffer);
  return bytesToHex(new Uint8Array(hashBuffer));
}

// Double SHA-256 (SHA-256 of SHA-256)
async function sha256d(data: Uint8Array): Promise<Uint8Array> {
  // Create a proper ArrayBuffer from Uint8Array
  const arrayBuffer = data.buffer.slice(data.byteOffset, data.byteOffset + data.byteLength) as ArrayBuffer;
  const firstHash = await crypto.subtle.digest("SHA-256", arrayBuffer);
  const secondHash = await crypto.subtle.digest("SHA-256", firstHash);
  return new Uint8Array(secondHash);
}

// RIPEMD160 hash (using CryptoJS library)
function ripemd160(data: string): string {
  return CryptoJS.RIPEMD160(CryptoJS.enc.Hex.parse(data)).toString();
}

// Base58 encoding (Bitcoin/LanaCoin standard)
function base58Encode(bytes: Uint8Array): string {
  const alphabet = "123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz";
  let num = BigInt('0x' + bytesToHex(bytes));
  let encoded = "";
  
  while (num > 0n) {
    let remainder = num % 58n;
    num = num / 58n;
    encoded = alphabet[Number(remainder)] + encoded;
  }
  
  // Handle leading zeros
  for (const byte of bytes) {
    if (byte !== 0) break;
    encoded = '1' + encoded;
  }
  
  return encoded;
}

// Base58 decoding
function base58Decode(encoded: string): Uint8Array {
  const alphabet = "123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz";
  let num = 0n;
  
  for (const char of encoded) {
    const index = alphabet.indexOf(char);
    if (index === -1) throw new Error('Invalid Base58 character');
    num = num * 58n + BigInt(index);
  }
  
  let hex = num.toString(16);
  if (hex.length % 2) hex = '0' + hex;
  
  let bytes = hexToBytes(hex);
  
  // Handle leading '1's (zeros)
  for (const char of encoded) {
    if (char !== '1') break;
    bytes = new Uint8Array([0, ...bytes]);
  }
  
  return bytes;
}

// Convert WIF to raw private key hex
async function wifToPrivateKey(wif: string): Promise<string> {
  try {
    // Decode Base58
    const decoded = base58Decode(wif);
    
    // Extract components
    const payload = decoded.slice(0, -4);
    const checksum = decoded.slice(-4);
    
    // Verify checksum
    const hash = await sha256d(payload);
    const expectedChecksum = hash.slice(0, 4);
    
    for (let i = 0; i < 4; i++) {
      if (checksum[i] !== expectedChecksum[i]) {
        throw new Error('Neveljavna WIF kontrolna vsota');
      }
    }
    
    // Verify prefix (0xb0 for LanaCoin)
    if (payload[0] !== 0xb0) {
      throw new Error('Neveljaven WIF prefix');
    }
    
    // Extract private key (32 bytes after prefix)
    const privateKey = payload.slice(1, 33);
    return bytesToHex(privateKey);
    
  } catch (error) {
    throw new Error(`Neveljaven WIF format: ${error instanceof Error ? error.message : 'Unknown error'}`);
  }
}

// Generate random private key (32 bytes)
export function generateRandomPrivateKey(): string {
  const randomBytes = new Uint8Array(32);
  crypto.getRandomValues(randomBytes);
  return bytesToHex(randomBytes);
}

// Encode private key to WIF (Wallet Import Format)
export async function privateKeyToWIF(privateKeyHex: string): Promise<string> {
  // Add version byte (0xb0 for LanaCoin)
  const extendedKey = 'b0' + privateKeyHex;
  
  // Calculate checksum (first 4 bytes of double SHA-256)
  const checksumFull = await sha256d(hexToBytes(extendedKey));
  const checksum = bytesToHex(checksumFull).substring(0, 8);
  
  // Combine and encode to Base58
  const wifHex = extendedKey + checksum;
  return base58Encode(hexToBytes(wifHex));
}

// Generate uncompressed public key from private key
export function generatePublicKey(privateKeyHex: string): string {
  const keyPair = ec.keyFromPrivate(privateKeyHex);
  const pubKeyPoint = keyPair.getPublic();
  
  // Return uncompressed format (04 + x + y coordinates)
  return "04" + 
         pubKeyPoint.getX().toString(16).padStart(64, '0') + 
         pubKeyPoint.getY().toString(16).padStart(64, '0');
}

// Generate compressed public key for Nostr (x-only)
function deriveNostrPublicKey(privateKeyHex: string): string {
  const keyPair = ec.keyFromPrivate(privateKeyHex);
  const pubKeyPoint = keyPair.getPublic();
  
  // Return only x-coordinate (32 bytes)
  return pubKeyPoint.getX().toString(16).padStart(64, '0');
}

// Generate LanaCoin wallet address from public key
export async function generateLanaAddress(publicKeyHex: string): Promise<string> {
  // Step 1: SHA-256 of public key
  const sha256Hash = await sha256(publicKeyHex);
  
  // Step 2: RIPEMD160 of SHA-256 hash
  const hash160 = ripemd160(sha256Hash);
  
  // Step 3: Add version byte (0x30 = 48 for LanaCoin)
  const versionedPayload = "30" + hash160;
  
  // Step 4: Double SHA-256 for checksum
  const checksum = await sha256(await sha256(versionedPayload));
  
  // Step 5: Take first 4 bytes of checksum
  const finalPayload = versionedPayload + checksum.substring(0, 8);
  
  // Step 6: Base58 encode
  return base58Encode(hexToBytes(finalPayload));
}

// Convert hex public key to npub format
function hexToNpub(hexPubKey: string): string {
  const data = hexToBytes(hexPubKey);
  const words = bech32.toWords(data);
  return bech32.encode('npub', words);
}

// Main function to convert WIF to all derived identifiers
export async function convertWifToIds(wif: string) {
  try {
    // Step 1: Extract private key from WIF
    const privateKeyHex = await wifToPrivateKey(wif);
    
    // Step 2: Generate public keys
    const publicKeyHex = generatePublicKey(privateKeyHex);
    const nostrHexId = deriveNostrPublicKey(privateKeyHex);
    
    // Step 3: Generate addresses/identifiers
    const walletId = await generateLanaAddress(publicKeyHex);
    const nostrNpubId = hexToNpub(nostrHexId);
    
    return {
      lanaPrivateKey: wif,
      walletId,
      nostrHexId,
      nostrNpubId,
      nostrPrivateKey: privateKeyHex
    };
    
  } catch (error) {
    throw new Error(`Konverzija ni uspela: ${error instanceof Error ? error.message : 'Unknown error'}`);
  }
}
