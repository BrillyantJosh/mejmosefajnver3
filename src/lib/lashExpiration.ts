import type { Event as NostrEvent } from 'nostr-tools';

const DEFAULT_EXPIRY_HOURS = 72; // 3 dni

/**
 * Check if a LASH payment record (KIND 39991) has expired
 * 
 * Rules:
 * 1. If "expires" tag exists → use that timestamp
 * 2. If no "expires" tag → default to 72h from created_at
 * 3. Expired intents are ignored in pending count (but not deleted)
 */
export const isLashExpired = (event: NostrEvent): boolean => {
  const now = Math.floor(Date.now() / 1000);
  const expiresTag = event.tags.find(tag => tag[0] === 'expires')?.[1];
  
  if (expiresTag) {
    // Explicit expiration timestamp provided
    const expiresAt = parseInt(expiresTag);
    return expiresAt < now;
  } else {
    // Default: 72h from created_at
    const defaultExpirySeconds = DEFAULT_EXPIRY_HOURS * 60 * 60;
    const expiresAt = event.created_at + defaultExpirySeconds;
    return expiresAt < now;
  }
};

/**
 * Calculate expiration timestamp for a new LASH
 * @param hoursFromNow - Hours until expiration (default: 72)
 */
export const calculateExpiration = (hoursFromNow: number = DEFAULT_EXPIRY_HOURS): number => {
  return Math.floor(Date.now() / 1000) + (hoursFromNow * 60 * 60);
};
