import { useState } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { useToast } from '@/hooks/use-toast';
import { SimplePool, finalizeEvent } from 'nostr-tools';
import { useSystemParameters } from '@/contexts/SystemParametersContext';

const DEFAULT_RELAYS = [
  'wss://relay.lanavault.space',
  'wss://relay.lanacoin-eternity.com',
  'wss://relay.lanaheartvoice.com'
];

interface UnpaidLash {
  eventId: string;
  lashId: string;
  recipientWallet: string;
  recipientPubkey: string;
  amount: string;
  amountLana: string;
  createdAt: number;
  recipientName?: string;
  recipientDisplayName?: string;
}

interface BatchSendResult {
  success: boolean;
  txid?: string;
  totalRecipients?: number;
  uniqueAddresses?: number;
  error?: string;
}

export const useBatchLashSender = () => {
  const [isSending, setIsSending] = useState(false);
  const { toast } = useToast();
  const { parameters } = useSystemParameters();

  const sendBatch = async (
    unpaidLashes: UnpaidLash[],
    privateKeyWIF: string,
    senderPrivkey: string,
    senderPubkey: string,
    changeAddress: string
  ): Promise<BatchSendResult> => {
    if (!unpaidLashes || unpaidLashes.length === 0) {
      return { success: false, error: 'No unpaid LASHes to send' };
    }

    if (!privateKeyWIF || !senderPrivkey || !senderPubkey || !changeAddress) {
      return { success: false, error: 'Missing required wallet information' };
    }

    setIsSending(true);

    try {
      console.log(`🎯 Starting batch send for ${unpaidLashes.length} LASHes`);

      const recipients = unpaidLashes.map(lash => ({
        address: lash.recipientWallet,
        amount: parseInt(lash.amount),
        recipientPubkey: lash.recipientPubkey,
        eventId: lash.eventId,
        lashId: lash.lashId
      }));

      toast({
        title: "Sending batch payment...",
        description: `Processing ${recipients.length} LASHes in one transaction`,
      });

      const { data, error } = await supabase.functions.invoke('send-lash-batch', {
        body: {
          privateKeyWIF,
          senderPrivkey,
          senderPubkey,
          recipients,
          changeAddress
        }
      });

      if (error) {
        console.error('❌ Batch send error:', error);
        // Don't show error toast - transaction will retry in next block
        return { success: false, error: error.message };
      }

      if (!data?.success) {
        console.error('❌ Batch send failed:', data?.error);
        // Don't show error toast - transaction will retry in next block
        return { success: false, error: data?.error };
      }

      console.log('✅ Batch send successful:', data);

      // Publish Nostr payment updates client-side (LASH Protocol 2.0)
      // Update existing KIND 39991 events with state="paid"
      const relays = parameters?.relays && parameters.relays.length > 0 
        ? parameters.relays 
        : DEFAULT_RELAYS;
      
      console.log(`📡 Publishing ${data.recipients.length} Nostr KIND 39991 payment updates to ${relays.length} relays...`);
      const pool = new SimplePool();
      const privateKeyBytes = new Uint8Array(
        senderPrivkey.match(/.{1,2}/g)!.map(byte => parseInt(byte, 16))
      );
      
      // Batch publish all payment status updates simultaneously
      const publishPromises = data.recipients.map((recipient, index) => {
        try {
          const nostrEvent = finalizeEvent({
            kind: 39991, // Replaceable event - will update existing record
            created_at: Math.floor(Date.now() / 1000),
            tags: [
              ['d', recipient.lashId], // Same d-tag = replaces previous event
              ['a', `0:${senderPubkey}`], // Sender identity
              ['p', recipient.recipientPubkey], // Recipient pubkey
              ['e', recipient.eventId], // Referenced event
              ['amount', recipient.amount.toString()],
              ['chain', 'LANA'],
              ['from_wallet', recipient.fromWallet],
              ['to_wallet', recipient.toWallet],
              ['state', 'paid'], // Updated state
              ['txid', data.txid], // On-chain transaction ID
              ['vout', recipient.vout.toString()], // Output index
              ['last_block', `${data.blockHeight},${data.blockTime}`] // Block info
            ],
            content: '', // Empty content for payment record
          }, privateKeyBytes);
          
          if ((index + 1) % 20 === 0) {
            console.log(`📤 Progress: ${index + 1}/${data.recipients.length} payment updates prepared`);
          }
          
          // pool.publish returns Promise<string>[] - publish to all relays
          return Promise.allSettled(pool.publish(relays, nostrEvent))
            .then(results => ({ success: true, lashId: recipient.lashId, results }))
            .catch(error => ({ success: false, lashId: recipient.lashId, error }));
        } catch (error) {
          console.error(`❌ Failed to prepare Nostr update for LASH ${recipient.lashId}:`, error);
          return Promise.resolve({ success: false, lashId: recipient.lashId, error });
        }
      });
      
      const results = await Promise.allSettled(publishPromises);
      const successCount = results.filter(r => r.status === 'fulfilled' && r.value.success).length;
      
      pool.close(relays);
      console.log(`✅ Successfully published ${successCount}/${data.recipients.length} payment updates`);

      toast({
        title: "✅ Batch sent successfully!",
        description: `${data.totalRecipients} LASHes paid to ${data.uniqueAddresses} addresses\nTX: ${data.txid?.slice(0, 8)}...${data.txid?.slice(-8)}`,
      });

      return {
        success: true,
        txid: data.txid,
        totalRecipients: data.totalRecipients,
        uniqueAddresses: data.uniqueAddresses
      };
    } catch (error) {
      console.error('❌ Exception during batch send:', error);
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';
      
      // Don't show error toast - transaction will retry in next block

      return { success: false, error: errorMessage };
    } finally {
      setIsSending(false);
    }
  };

  return {
    sendBatch,
    isSending
  };
};
