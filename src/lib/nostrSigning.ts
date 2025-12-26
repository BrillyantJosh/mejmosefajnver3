import { finalizeEvent, getPublicKey } from 'nostr-tools/pure';

interface NostrEvent {
  id: string;
  pubkey: string;
  created_at: number;
  kind: number;
  tags: string[][];
  content: string;
  sig: string;
}

// Helper: Hex to Uint8Array
function hexToBytes(hex: string): Uint8Array {
  if (hex.length % 2) hex = '0' + hex;
  const bytes = new Uint8Array(hex.length / 2);
  for (let i = 0; i < hex.length; i += 2) {
    bytes[i / 2] = parseInt(hex.slice(i, i + 2), 16);
  }
  return bytes;
}

/**
 * Create and sign a Nostr event using nostr-tools
 */
export function signNostrEvent(
  privateKeyHex: string,
  kind: number,
  content: string,
  tags: string[][] = []
): NostrEvent {
  const secretKey = hexToBytes(privateKeyHex);
  
  const eventTemplate = {
    kind,
    content,
    tags,
    created_at: Math.floor(Date.now() / 1000),
  };
  
  // finalizeEvent adds id, pubkey, sig
  const signedEvent = finalizeEvent(eventTemplate, secretKey);
  
  return signedEvent as NostrEvent;
}

/**
 * Create a signed authentication event for admin operations
 * Uses kind 22242 (ephemeral authentication event)
 */
export function createSignedAdminAuthEvent(
  privateKeyHex: string,
  pubkeyHex: string,
  action: string,
  key: string
): NostrEvent {
  const content = JSON.stringify({
    action,
    key,
    timestamp: Date.now(),
  });
  
  return signNostrEvent(
    privateKeyHex,
    22242, // Ephemeral auth event kind
    content,
    [['action', action], ['key', key]]
  );
}
