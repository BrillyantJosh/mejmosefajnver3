// =============================================
// Encrypted Group Rooms - Crypto Helpers
// AES-256-GCM for group messages + NIP-44 for key distribution
// =============================================

import { nip44 } from 'nostr-tools';
import type { RoomInvitePayload } from '@/types/encryptedRooms';

// ---- Conversion Helpers ----

export const hexToBytes = (hex: string): Uint8Array => {
  const bytes = new Uint8Array(hex.length / 2);
  for (let i = 0; i < hex.length; i += 2) {
    bytes[i / 2] = parseInt(hex.slice(i, i + 2), 16);
  }
  return bytes;
};

export const bytesToHex = (bytes: Uint8Array): string => {
  return Array.from(bytes)
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
};

const bytesToBase64 = (bytes: Uint8Array): string => {
  let binary = '';
  for (let i = 0; i < bytes.length; i++) {
    binary += String.fromCharCode(bytes[i]);
  }
  return btoa(binary);
};

const base64ToBytes = (base64: string): Uint8Array => {
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) {
    bytes[i] = binary.charCodeAt(i);
  }
  return bytes;
};

// ---- Key Generation ----

/**
 * Generate a 256-bit AES group key as hex string (64 chars)
 */
export const generateGroupKey = (): string => {
  const keyBytes = crypto.getRandomValues(new Uint8Array(32));
  return bytesToHex(keyBytes);
};

/**
 * Validate group key format: must be 64 hex characters
 */
export const isValidGroupKey = (key: string): boolean => {
  return /^[0-9a-fA-F]{64}$/.test(key);
};

// ---- AES-256-GCM Message Encryption ----

/**
 * Import AES-256-GCM key from hex string for Web Crypto API
 */
const importAesKey = async (groupKeyHex: string): Promise<CryptoKey> => {
  const keyBytes = hexToBytes(groupKeyHex);
  return crypto.subtle.importKey(
    'raw',
    keyBytes,
    { name: 'AES-GCM' },
    false,
    ['encrypt', 'decrypt']
  );
};

/**
 * Encrypt a room message with AES-256-GCM
 * Returns base64 string: base64(iv[12] + ciphertext + authTag[16])
 */
export const encryptRoomMessage = async (
  plaintext: string,
  groupKeyHex: string
): Promise<string> => {
  const aesKey = await importAesKey(groupKeyHex);
  const iv = crypto.getRandomValues(new Uint8Array(12)); // 96-bit IV for GCM
  const encoder = new TextEncoder();
  const plaintextBytes = encoder.encode(plaintext);

  const ciphertextWithTag = await crypto.subtle.encrypt(
    { name: 'AES-GCM', iv },
    aesKey,
    plaintextBytes
  );

  // Concatenate iv + ciphertext+authTag
  const result = new Uint8Array(iv.length + ciphertextWithTag.byteLength);
  result.set(iv, 0);
  result.set(new Uint8Array(ciphertextWithTag), iv.length);

  return bytesToBase64(result);
};

/**
 * Decrypt a room message with AES-256-GCM
 * Expects base64 string: base64(iv[12] + ciphertext + authTag[16])
 */
export const decryptRoomMessage = async (
  ciphertext: string,
  groupKeyHex: string
): Promise<string> => {
  const aesKey = await importAesKey(groupKeyHex);
  const data = base64ToBytes(ciphertext);

  // Extract IV (first 12 bytes) and ciphertext+authTag (rest)
  const iv = data.slice(0, 12);
  const encryptedData = data.slice(12);

  const decrypted = await crypto.subtle.decrypt(
    { name: 'AES-GCM', iv },
    aesKey,
    encryptedData
  );

  const decoder = new TextDecoder();
  return decoder.decode(decrypted);
};

// ---- NIP-44 Key Distribution ----

/**
 * Encrypt group key + invite payload for a specific member using NIP-44
 */
export const encryptInvitePayload = (
  payload: RoomInvitePayload,
  senderPrivKeyHex: string,
  recipientPubkey: string
): string => {
  const senderPrivKeyBytes = hexToBytes(senderPrivKeyHex);
  const conversationKey = nip44.v2.utils.getConversationKey(
    senderPrivKeyBytes,
    recipientPubkey
  );
  return nip44.v2.encrypt(JSON.stringify(payload), conversationKey);
};

/**
 * Decrypt invite payload from NIP-44 encrypted content
 */
export const decryptInvitePayload = (
  encryptedContent: string,
  recipientPrivKeyHex: string,
  senderPubkey: string
): RoomInvitePayload => {
  const recipientPrivKeyBytes = hexToBytes(recipientPrivKeyHex);
  const conversationKey = nip44.v2.utils.getConversationKey(
    recipientPrivKeyBytes,
    senderPubkey
  );
  const decrypted = nip44.v2.decrypt(encryptedContent, conversationKey);
  return JSON.parse(decrypted) as RoomInvitePayload;
};

// ---- Key Cache (localStorage) ----

const CACHE_PREFIX = 'enc_room_key';

/**
 * Get cached group key from localStorage
 */
export const getRoomKeyFromCache = (
  roomEventId: string,
  keyVersion: number = 1
): string | null => {
  const cacheKey = `${CACHE_PREFIX}:${roomEventId}:v${keyVersion}`;
  const cached = localStorage.getItem(cacheKey);
  if (cached && isValidGroupKey(cached)) {
    return cached;
  }
  // Clean up invalid cache
  if (cached) {
    localStorage.removeItem(cacheKey);
  }
  return null;
};

/**
 * Store group key in localStorage cache
 */
export const setRoomKeyToCache = (
  roomEventId: string,
  keyVersion: number,
  key: string
): void => {
  if (!isValidGroupKey(key)) {
    console.warn('Attempted to cache invalid group key');
    return;
  }
  const cacheKey = `${CACHE_PREFIX}:${roomEventId}:v${keyVersion}`;
  localStorage.setItem(cacheKey, key);
};

/**
 * Remove cached key (e.g. on leave/removal)
 */
export const removeRoomKeyFromCache = (
  roomEventId: string,
  keyVersion?: number
): void => {
  if (keyVersion !== undefined) {
    localStorage.removeItem(`${CACHE_PREFIX}:${roomEventId}:v${keyVersion}`);
  } else {
    // Remove all versions for this room
    const keysToRemove: string[] = [];
    for (let i = 0; i < localStorage.length; i++) {
      const key = localStorage.key(i);
      if (key && key.startsWith(`${CACHE_PREFIX}:${roomEventId}:`)) {
        keysToRemove.push(key);
      }
    }
    keysToRemove.forEach((k) => localStorage.removeItem(k));
  }
};

/**
 * Find the latest cached key version for a room
 */
export const getLatestCachedKeyVersion = (roomEventId: string): number => {
  let maxVersion = 0;
  for (let i = 0; i < localStorage.length; i++) {
    const key = localStorage.key(i);
    if (key && key.startsWith(`${CACHE_PREFIX}:${roomEventId}:v`)) {
      const version = parseInt(key.split(':v')[1], 10);
      if (!isNaN(version) && version > maxVersion) {
        maxVersion = version;
      }
    }
  }
  return maxVersion;
};
