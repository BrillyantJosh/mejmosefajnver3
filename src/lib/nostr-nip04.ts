import { getPublicKey } from 'nostr-tools/pure';
import * as secp256k1 from '@noble/secp256k1';

// Helper: Hex to Uint8Array
function hexToBytes(hex: string): Uint8Array {
  if (hex.length % 2) hex = '0' + hex;
  const bytes = new Uint8Array(hex.length / 2);
  for (let i = 0; i < hex.length; i += 2) {
    bytes[i / 2] = parseInt(hex.slice(i, i + 2), 16);
  }
  return bytes;
}

// Helper: Uint8Array to Hex
function bytesToHex(bytes: Uint8Array): string {
  return Array.from(bytes, b => b.toString(16).padStart(2, '0')).join('');
}

// Helper: Base64 to Uint8Array
function fromB64(base64: string): Uint8Array {
  return Uint8Array.from(atob(base64), c => c.charCodeAt(0));
}

// Helper: Uint8Array to Base64
function toB64(bytes: Uint8Array): string {
  return btoa(String.fromCharCode(...bytes));
}

// SHA-256 hash
async function sha256(data: Uint8Array): Promise<Uint8Array> {
  const buffer = data.buffer.slice(data.byteOffset, data.byteOffset + data.byteLength) as ArrayBuffer;
  const hashBuffer = await crypto.subtle.digest('SHA-256', buffer);
  return new Uint8Array(hashBuffer);
}

// Normalize X coordinate from shared secret
function normalizeX(shared: Uint8Array): Uint8Array {
  // If compressed (33 bytes), skip first byte (0x02 or 0x03)
  // If uncompressed (65 bytes), skip first byte (0x04) and take next 32 bytes
  if (shared.length === 33) {
    return shared.slice(1, 33);
  } else if (shared.length === 65) {
    return shared.slice(1, 33);
  }
  // Already 32 bytes
  return shared.slice(0, 32);
}

// PKCS7 Padding
function pkcs7Pad(data: Uint8Array): Uint8Array {
  const blockSize = 16;
  const padLength = blockSize - (data.length % blockSize);
  const padded = new Uint8Array(data.length + padLength);
  padded.set(data);
  for (let i = data.length; i < padded.length; i++) {
    padded[i] = padLength;
  }
  return padded;
}

// PKCS7 Unpadding
function pkcs7Unpad(data: Uint8Array): Uint8Array {
  if (data.length === 0) throw new Error('Empty data');
  const padLength = data[data.length - 1];
  
  // Validate padding
  if (padLength > 16 || padLength > data.length) {
    throw new Error(`Invalid padding length: ${padLength}`);
  }
  
  // Check all padding bytes are correct
  for (let i = data.length - padLength; i < data.length; i++) {
    if (data[i] !== padLength) {
      throw new Error(`Invalid padding byte at position ${i}: ${data[i]}`);
    }
  }
  
  return data.slice(0, data.length - padLength);
}

/**
 * NIP-04 Key Derivation (ECDH + SHA-256)
 * 
 * @param myPrivKeyHex - My private key (64 hex chars)
 * @param theirPubKeyHex - Their public key, x-only (64 hex chars)
 * @returns Shared secret (32 bytes)
 */
async function deriveKey(myPrivKeyHex: string, theirPubKeyHex: string): Promise<Uint8Array> {
  try {
    // Add '02' prefix to make compressed public key
    const theirPubKeyCompressed = '02' + theirPubKeyHex;
    
    const myPrivBytes = hexToBytes(myPrivKeyHex);
    const theirPubBytes = hexToBytes(theirPubKeyCompressed);
    
    // Perform ECDH to get shared secret
    const shared = secp256k1.getSharedSecret(myPrivBytes, theirPubBytes, true);
    
    // Extract X coordinate (32 bytes)
    const x = normalizeX(shared);
    
    // SHA-256 hash to get final key
    const key = await sha256(x);
    
    return key;
  } catch (error) {
    console.error('❌ deriveKey failed:', error);
    throw new Error(`Key derivation failed: ${error instanceof Error ? error.message : 'Unknown'}`);
  }
}

/**
 * NIP-04 Encrypt
 * 
 * @param plaintext - Message to encrypt
 * @param senderPrivKeyHex - Sender's private key (64 hex)
 * @param recipientPubKeyHex - Recipient's public key, x-only (64 hex)
 * @returns Encrypted string in format "base64_ciphertext?iv=base64_iv"
 */
export async function nip04Encrypt(
  plaintext: string,
  senderPrivKeyHex: string,
  recipientPubKeyHex: string
): Promise<string> {
  try {
    // 1. Derive shared key
    const keyBytes = await deriveKey(senderPrivKeyHex, recipientPubKeyHex);
    
    // 2. Import as AES-CBC key
    const keyBuffer = keyBytes.buffer.slice(keyBytes.byteOffset, keyBytes.byteOffset + keyBytes.byteLength) as ArrayBuffer;
    const cryptoKey = await crypto.subtle.importKey(
      'raw',
      keyBuffer,
      { name: 'AES-CBC' },
      false,
      ['encrypt']
    );
    
    // 3. Generate random IV
    const iv = crypto.getRandomValues(new Uint8Array(16));
    
    // 4. Encode and pad plaintext
    const plaintextBytes = new TextEncoder().encode(plaintext);
    const padded = pkcs7Pad(plaintextBytes);
    
    // 5. Encrypt
    const paddedBuffer = padded.buffer.slice(padded.byteOffset, padded.byteOffset + padded.byteLength) as ArrayBuffer;
    const encrypted = await crypto.subtle.encrypt(
      { name: 'AES-CBC', iv },
      cryptoKey,
      paddedBuffer
    );
    
    const ciphertext = new Uint8Array(encrypted);
    
    // 6. Format: "base64_ciphertext?iv=base64_iv"
    return `${toB64(ciphertext)}?iv=${toB64(iv)}`;
  } catch (error) {
    console.error('❌ nip04Encrypt failed:', error);
    throw new Error(`Encryption failed: ${error instanceof Error ? error.message : 'Unknown'}`);
  }
}

/**
 * NIP-04 Decrypt
 * 
 * @param encryptedContent - Encrypted string in format "base64_ciphertext?iv=base64_iv"
 * @param recipientPrivKeyHex - Recipient's private key (64 hex)
 * @param senderPubKeyHex - Sender's public key, x-only (64 hex)
 * @returns Decrypted plaintext
 */
export async function nip04Decrypt(
  encryptedContent: string,
  recipientPrivKeyHex: string,
  senderPubKeyHex: string
): Promise<string> {
  try {
    // 1. Parse encrypted content
    const parts = encryptedContent.split('?iv=');
    if (parts.length !== 2) {
      throw new Error(`Invalid format: expected "ciphertext?iv=iv", got: ${encryptedContent.slice(0, 50)}...`);
    }
    
    const [ctB64, ivB64] = parts;
    
    // 2. Derive shared key (MUST use same key derivation as encryption!)
    const keyBytes = await deriveKey(recipientPrivKeyHex, senderPubKeyHex);
    
    // 3. Import as AES-CBC key
    const keyBuffer = keyBytes.buffer.slice(keyBytes.byteOffset, keyBytes.byteOffset + keyBytes.byteLength) as ArrayBuffer;
    const cryptoKey = await crypto.subtle.importKey(
      'raw',
      keyBuffer,
      { name: 'AES-CBC' },
      false,
      ['decrypt']
    );
    
    // 4. Decode base64
    const ciphertext = fromB64(ctB64);
    const iv = fromB64(ivB64);
    
    // 5. Decrypt
    const ciphertextBuffer = ciphertext.buffer.slice(ciphertext.byteOffset, ciphertext.byteOffset + ciphertext.byteLength) as ArrayBuffer;
    const ivBuffer = iv.buffer.slice(iv.byteOffset, iv.byteOffset + iv.byteLength) as ArrayBuffer;
    const decrypted = await crypto.subtle.decrypt(
      { name: 'AES-CBC', iv: ivBuffer },
      cryptoKey,
      ciphertextBuffer
    );
    
    // 6. Unpad and decode
    const unpaded = pkcs7Unpad(new Uint8Array(decrypted));
    const plaintext = new TextDecoder().decode(unpaded);
    
    return plaintext;
  } catch (error) {
    console.error('❌ nip04Decrypt failed:', {
      error: error instanceof Error ? error.message : 'Unknown',
      encryptedPreview: encryptedContent.slice(0, 50) + '...',
      senderPubKey: senderPubKeyHex.slice(0, 8) + '...'
    });
    throw error;
  }
}
