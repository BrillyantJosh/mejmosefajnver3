/**
 * LanaCoin Wallet ID Validation
 * Validates wallet addresses according to LanaCoin specifications
 */

// Base58 alphabet (Bitcoin/LanaCoin standard)
const BASE58_ALPHABET = "123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz";

/**
 * Convert hexadecimal string to byte array
 */
function hexToBytes(hex: string): Uint8Array {
  return new Uint8Array(hex.match(/.{2}/g)!.map(byte => parseInt(byte, 16)));
}

/**
 * Convert byte array to hexadecimal string
 */
function bytesToHex(bytes: Uint8Array): string {
  return Array.from(bytes, b => b.toString(16).padStart(2, '0')).join('');
}

/**
 * Decode Base58 string to bytes
 */
function base58Decode(encoded: string): Uint8Array {
  let num = 0n;
  
  for (const char of encoded) {
    const index = BASE58_ALPHABET.indexOf(char);
    if (index === -1) {
      throw new Error('Invalid Base58 character');
    }
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

/**
 * Double SHA-256 hash
 */
async function sha256d(data: Uint8Array): Promise<Uint8Array> {
  const firstHash = await crypto.subtle.digest("SHA-256", new Uint8Array(data));
  const secondHash = await crypto.subtle.digest("SHA-256", firstHash);
  return new Uint8Array(secondHash);
}

/**
 * Validate LanaCoin wallet address
 * @param walletId - The wallet address to validate
 * @returns true if valid, false otherwise
 */
export async function validateLanaWalletId(walletId: string): Promise<boolean> {
  try {
    // Basic format checks
    if (!walletId || typeof walletId !== 'string') {
      return false;
    }
    
    // LanaCoin addresses start with 'L' (version byte 0x30)
    if (!walletId.startsWith('L')) {
      return false;
    }
    
    // Check length (typical range for Base58 encoded addresses)
    if (walletId.length < 26 || walletId.length > 35) {
      return false;
    }
    
    // Check for valid Base58 characters only
    for (const char of walletId) {
      if (!BASE58_ALPHABET.includes(char)) {
        return false;
      }
    }
    
    // Decode and verify checksum
    const decoded = base58Decode(walletId);
    
    if (decoded.length !== 25) {
      return false;
    }
    
    // Split payload and checksum
    const payload = decoded.slice(0, 21);
    const checksum = decoded.slice(21, 25);
    
    // Verify version byte (0x30 for LanaCoin)
    if (payload[0] !== 0x30) {
      return false;
    }
    
    // Calculate expected checksum
    const hash = await sha256d(payload);
    const expectedChecksum = hash.slice(0, 4);
    
    // Compare checksums
    for (let i = 0; i < 4; i++) {
      if (checksum[i] !== expectedChecksum[i]) {
        return false;
      }
    }
    
    return true;
    
  } catch (error) {
    console.error('Wallet validation error:', error);
    return false;
  }
}

/**
 * Validate with user-friendly error messages
 */
export async function validateLanaWalletIdWithMessage(walletId: string): Promise<{ valid: boolean; message?: string }> {
  if (!walletId || !walletId.trim()) {
    return { valid: false, message: "Wallet ID is required" };
  }
  
  if (!walletId.startsWith('L')) {
    return { valid: false, message: "Invalid wallet ID format. LanaCoin addresses start with 'L'" };
  }
  
  if (walletId.length < 26 || walletId.length > 35) {
    return { valid: false, message: "Invalid wallet ID length" };
  }
  
  const valid = await validateLanaWalletId(walletId);
  
  if (!valid) {
    return { valid: false, message: "Invalid wallet ID checksum or format" };
  }
  
  return { valid: true };
}
