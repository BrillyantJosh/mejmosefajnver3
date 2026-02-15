// =============================================
// Encrypted Group Rooms - Type Definitions
// =============================================

export interface EncryptedRoom {
  id: string;                    // Nostr event ID of KIND 30100
  roomId: string;                // d-tag value (e.g. "room:uuid")
  name: string;
  description: string;
  image?: string;
  ownerPubkey: string;
  members: RoomMember[];
  status: 'active' | 'archived' | 'read-only' | 'deleted';
  keyVersion: number;
  createdAt: number;             // Unix timestamp
  eventId: string;               // Same as id, for clarity
}

export interface RoomMember {
  pubkey: string;
  role: 'owner' | 'admin' | 'member' | 'readonly';
  joinedAt?: number;
  displayName?: string;
  picture?: string;
}

export interface RoomMessage {
  id: string;                    // Nostr event ID
  roomEventId: string;           // Reference to room
  senderPubkey: string;
  senderName?: string;
  senderPicture?: string;
  text: string;
  type: 'text' | 'image' | 'audio' | 'file' | 'system';
  mediaUrl?: string;
  mediaType?: string;
  mediaSize?: number;
  replyToId?: string;
  replyToText?: string;
  keyVersion: number;
  createdAt: number;
  decryptionFailed?: boolean;
}

export interface RoomInvite {
  id: string;                    // Nostr event ID of KIND 1102
  roomEventId: string;
  roomId: string;
  roomName: string;
  inviterPubkey: string;
  inviterName?: string;
  inviterPicture?: string;
  inviteePubkey: string;
  groupKey: string;              // Decrypted AES-256 group key (hex)
  keyVersion: number;
  role: 'member' | 'admin' | 'readonly';
  message?: string;
  createdAt: number;
  status: 'pending' | 'accepted' | 'rejected';
}

export interface RoomInviteResponse {
  id: string;                    // Nostr event ID of KIND 1103
  inviteEventId: string;
  roomEventId: string;
  responderPubkey: string;
  response: 'accept' | 'reject';
  createdAt: number;
}

export interface RoomMemberAction {
  id: string;                    // Nostr event ID of KIND 1105
  roomEventId: string;
  actorPubkey: string;
  targetPubkey: string;
  action: 'remove' | 'leave';
  createdAt: number;
}

// Content structure for encrypted messages (KIND 1101)
export interface RoomMessageContent {
  text: string;
  type: 'text' | 'image' | 'audio' | 'file' | 'system';
  mediaUrl?: string;
  mediaType?: string;
  mediaSize?: number;
}

// Content structure for invite payload (KIND 1102, encrypted with NIP-44)
export interface RoomInvitePayload {
  roomId: string;
  roomEventId: string;
  roomName: string;
  groupKey: string;
  keyVersion: number;
  role: 'member' | 'admin' | 'readonly';
  message?: string;
}

// Room read status (SQLite)
export interface RoomReadStatus {
  id: string;
  userNostrId: string;
  roomEventId: string;
  lastReadAt: number;
  createdAt: string;
  updatedAt: string;
}
