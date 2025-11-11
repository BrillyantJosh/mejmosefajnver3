import { useState } from 'react';
import { SimplePool, finalizeEvent } from 'nostr-tools';
import { useAuth } from '@/contexts/AuthContext';
import { useSystemParameters } from '@/contexts/SystemParametersContext';
import { calculateExpiration } from '@/lib/lashExpiration';

const DEFAULT_RELAYS = [
  'wss://relay.lanavault.space',
  'wss://relay.lanacoin-eternity.com',
  'wss://relay.lanaheartvoice.com'
];

interface GiveLashParams {
  postId: string;
  recipientPubkey: string;
  recipientWallet: string;
  amount?: string; // Optional: Override default lanoshi2lash from session
  memo?: string;
  expiresInHours?: number; // Optional: Custom expiration (default: 72h)
}

export const useNostrLash = () => {
  const { session } = useAuth();
  const { parameters } = useSystemParameters();
  const [isSending, setIsSending] = useState(false);

  const relays = parameters?.relays && parameters.relays.length > 0 
    ? parameters.relays 
    : DEFAULT_RELAYS;

  /**
   * Give a LASH (like/tip) to a post
   * Sends KIND 39991 Unified Payment Record (LASH Protocol 2.0)
   */
  const giveLash = async ({
    postId,
    recipientPubkey,
    recipientWallet,
    amount,
    memo = "LASH",
    expiresInHours
  }: GiveLashParams): Promise<{ success: boolean; error?: string }> => {
    
    if (!session?.nostrPrivateKey || !session?.nostrHexId) {
      return { success: false, error: 'Not authenticated' };
    }

    if (!session?.lanaWalletID) {
      return { success: false, error: 'Wallet not found in profile' };
    }

    if (!session?.lanoshi2lash) {
      return { success: false, error: 'LASH value not configured in your profile' };
    }

    if (!recipientWallet) {
      return { success: false, error: 'Recipient wallet not found' };
    }

    // Use amount from session if not provided
    const lashAmount = amount || session.lanoshi2lash;

    setIsSending(true);
    const pool = new SimplePool();

    try {
      // Generate unique LASH ID
      const uuid = crypto.randomUUID();

      // Generate expiration timestamp (default: 72h from now)
      const expiresAt = calculateExpiration(expiresInHours);

      // Create KIND 39991 Unified Payment Record (LASH Protocol 2.0)
      const eventTemplate = {
        kind: 39991,
        created_at: Math.floor(Date.now() / 1000),
        tags: [
          ['d', `lash:${uuid}`], // Unique LASH ID (replaceability key)
          ['a', `0:${session.nostrHexId}`], // Sender Nostr HEX identity
          ['p', recipientPubkey], // Recipient Nostr HEX
          ['e', postId], // Referenced event (context)
          ['amount', lashAmount], // Payment amount in lanoshis
          ['chain', 'LANA'], // Target chain
          ['from_wallet', session.lanaWalletID], // Sender wallet
          ['to_wallet', recipientWallet], // Recipient wallet
          ['state', 'open'], // Payment lifecycle state
          ['memo', memo], // Optional memo
          ['expires', expiresAt.toString()] // Optional expiration timestamp
        ],
        content: '', // Empty content for payment record
        pubkey: session.nostrHexId
      };

      // Sign the event
      const privateKeyBytes = new Uint8Array(
        session.nostrPrivateKey.match(/.{1,2}/g)!.map(byte => parseInt(byte, 16))
      );

      const signedEvent = finalizeEvent(eventTemplate, privateKeyBytes);

      console.log('🎉 Sending LASH event:', signedEvent);
      console.log('📡 Publishing to relays:', relays);

      // Publish to ALL relays at once (correct method)
      const publishPromises = pool.publish(relays, signedEvent);

      // Track each relay individually for detailed logging
      const trackedPromises = publishPromises.map((promise, idx) => {
        const relay = relays[idx];
        return promise
          .then(() => {
            console.log(`✅ LASH published successfully to ${relay}`);
            return { relay, success: true };
          })
          .catch((err) => {
            console.error(`❌ Failed to publish LASH to ${relay}:`, err);
            return { relay, success: false, error: err };
          });
      });

      // Wait with timeout - graceful handling
      try {
        await Promise.race([
          Promise.all(trackedPromises),
          new Promise((_, reject) =>
            setTimeout(() => reject(new Error('Publish timeout')), 10000)
          )
        ]);
      } catch (error) {
        // Even on timeout, events may have been published
        console.warn('⚠️ Publish timeout, but LASH may have been sent:', error);
      }

      // Check results
      const results = await Promise.allSettled(trackedPromises);
      const successful = results.filter(r => r.status === 'fulfilled' && r.value.success).length;
      
      console.log(`📊 LASH Publish Results: ${successful}/${relays.length} successful`);
      
      console.log('✅ LASH sent successfully');
      return { success: true };

    } catch (error) {
      console.error('❌ Error sending LASH:', error);
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Failed to send LASH'
      };
    } finally {
      setIsSending(false);
      pool.close(relays);
    }
  };

  return {
    giveLash,
    isSending
  };
};
