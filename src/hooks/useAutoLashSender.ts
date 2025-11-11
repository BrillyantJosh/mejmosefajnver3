import { useState, useEffect, useRef } from 'react';
import { useAuth } from '@/contexts/AuthContext';
import { UnpaidLashDetail, useNostrUnpaidLashDetails } from '@/hooks/useNostrUnpaidLashDetails';
import { useBatchLashSender } from '@/hooks/useBatchLashSender';
import { supabase } from '@/integrations/supabase/client';
import { toast } from 'sonner';

interface BlockStatus {
  canSend: boolean;
  lastBlock?: number;
  currentBlock?: number;
  blockTime?: number;
  error?: string;
}

const CHECK_INTERVAL = 120000; // 2 minutes

interface UseAutoLashSenderParams {
  allLashes?: UnpaidLashDetail[];
  refetch?: () => void;
  enabled?: boolean;
}

export const useAutoLashSender = (params?: UseAutoLashSenderParams) => {
  const { session } = useAuth();
  
  // Use provided data OR fetch internally
  const internalData = useNostrUnpaidLashDetails();
  const allLashes = params?.allLashes ?? internalData.allLashes;
  const refetch = params?.refetch ?? internalData.refetch;
  const enabled = params?.enabled !== false; // Default to true
  
  const { sendBatch, isSending } = useBatchLashSender();
  
  const [blockStatus, setBlockStatus] = useState<BlockStatus>({ canSend: true });
  const [checkingBlock, setCheckingBlock] = useState(false);
  const [countdown, setCountdown] = useState(120);
  const [autoSendEnabled, setAutoSendEnabled] = useState(true);
  const [lastAutoSendBlock, setLastAutoSendBlock] = useState<number | null>(null);
  const lastLashesChangeRef = useRef<number>(Date.now());
  const [isStable, setIsStable] = useState(false);

  const checkBlockStatus = async () => {
    if (!session?.nostrHexId) return;
    
    setCheckingBlock(true);
    try {
      const { data, error } = await supabase.functions.invoke('check-send-eligibility', {
        body: { senderPubkey: session.nostrHexId }
      });

      if (error) {
        console.error('❌ Error checking block status:', error);
        setBlockStatus({ canSend: true });
        return;
      }

      setBlockStatus(data);
      console.log('📊 Block status:', data);
      setCountdown(120); // Reset countdown
    } catch (error) {
      console.error('❌ Exception checking block status:', error);
      setBlockStatus({ canSend: true });
    } finally {
      setCheckingBlock(false);
    }
  };

  // Load auto-send preference from localStorage
  useEffect(() => {
    const saved = localStorage.getItem('lash-auto-send-enabled');
    if (saved !== null) {
      setAutoSendEnabled(saved === 'true');
    }
  }, []);

  // Save auto-send preference to localStorage
  useEffect(() => {
    localStorage.setItem('lash-auto-send-enabled', autoSendEnabled.toString());
  }, [autoSendEnabled]);

  // Block status checks and countdown
  useEffect(() => {
    if (!session?.nostrHexId) return;
    
    checkBlockStatus();
    
    // Check every 2 minutes
    const checkInterval = setInterval(() => {
      checkBlockStatus();
    }, CHECK_INTERVAL);
    
    // Countdown timer
    const countdownInterval = setInterval(() => {
      setCountdown(prev => {
        if (prev <= 1) {
          return 120;
        }
        return prev - 1;
      });
    }, 1000);

    return () => {
      clearInterval(checkInterval);
      clearInterval(countdownInterval);
    };
  }, [session?.nostrHexId]);

  // Track when allLashes changes and wait for it to stabilize
  useEffect(() => {
    lastLashesChangeRef.current = Date.now();
    setIsStable(false);
    
    // Wait 5 seconds after last change to consider list stable
    const stabilityTimer = setTimeout(() => {
      setIsStable(true);
      console.log('📊 LASH list stabilized, auto-send can proceed');
    }, 5000);
    
    return () => clearTimeout(stabilityTimer);
  }, [allLashes.length, allLashes]);

  // Auto-send effect
  useEffect(() => {
    // Skip if disabled
    if (!enabled) return;
    
    const handleAutoSend = async () => {
      if (!session?.lanaPrivateKey || !session?.nostrPrivateKey || 
          !session?.nostrHexId || !session?.lanaWalletID) {
        return;
      }
      
      // Mark this block as processed to prevent double-send
      setLastAutoSendBlock(blockStatus.currentBlock);
      
      console.log(`🤖 AUTO-SEND: Sending ${allLashes.length} LASHes automatically`);
      
      const result = await sendBatch(
        allLashes,
        session.lanaPrivateKey,
        session.nostrPrivateKey,
        session.nostrHexId,
        session.lanaWalletID
      );
      
      if (result.success) {
        toast.success(
          `🤖 Auto-paid ${result.totalRecipients} LASHes to ${result.uniqueAddresses} addresses`,
          {
            description: `TX: ${result.txid?.slice(0, 8)}...${result.txid?.slice(-8)}`
          }
        );
        
        setTimeout(() => {
          console.log('🔄 Auto-send: Refetching after confirmation');
          refetch();
          checkBlockStatus();
        }, 10000);
      }
    };

    // Trigger auto-send when conditions are met AND list is stable
    if (
      autoSendEnabled &&
      !isSending &&
      !checkingBlock &&
      blockStatus.canSend &&
      allLashes.length > 0 &&
      isStable &&
      session?.lanaPrivateKey &&
      session?.nostrPrivateKey &&
      session?.nostrHexId &&
      session?.lanaWalletID &&
      blockStatus.currentBlock !== lastAutoSendBlock
    ) {
      console.log('🤖 Auto-send triggered: Sending all pending LASHes...');
      handleAutoSend();
    }
  }, [enabled, blockStatus, allLashes, isSending, autoSendEnabled, checkingBlock, session, lastAutoSendBlock, isStable, sendBatch, refetch]);

  return {
    blockStatus,
    checkingBlock,
    countdown,
    autoSendEnabled,
    setAutoSendEnabled,
    checkBlockStatus,
    isStable
  };
};
