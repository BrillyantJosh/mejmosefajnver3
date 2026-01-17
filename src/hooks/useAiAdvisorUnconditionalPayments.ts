import { useState, useEffect, useMemo, useCallback } from 'react';
import { useAuth } from '@/contexts/AuthContext';
import { useNostrDonationProposals, DonationProposal } from './useNostrDonationProposals';
import { useNostrDonationPayments, DonationPayment } from './useNostrDonationPayments';
import { useNostrProfilesCacheBulk } from './useNostrProfilesCacheBulk';
import { fiatToLana, formatCurrency, formatLana } from '@/lib/currencyConversion';
import { format } from 'date-fns';

export interface UnconditionalPaymentSummary {
  id: string;
  dTag: string;
  service: string;
  description: string;
  recipientName: string;
  recipientPubkey: string;
  recipientWallet: string;
  fiatAmount: string;
  fiatCurrency: string;
  lanaAmount: number;
  lanaAmountFormatted: string;
  fiatAmountFormatted: string;
  createdAt: number;
  createdAtFormatted: string;
  expiresAt?: number;
  expiresAtFormatted?: string;
  isExpired: boolean;
  ref?: string;
  url?: string;
  paymentLink: string;
}

export interface UnconditionalPaymentsContext {
  pendingCount: number;
  totalLanaAmount: number;
  totalLanaFormatted: string;
  pendingPayments: UnconditionalPaymentSummary[];
  completedCount: number;
}

export function useAiAdvisorUnconditionalPayments() {
  const { session } = useAuth();
  
  // Fetch proposals for the current user
  const { proposals, isLoading: proposalsLoading } = useNostrDonationProposals(
    session?.nostrHexId,
    { poll: false, enabled: !!session?.nostrHexId }
  );
  
  // Fetch payments to check which are already paid
  const { payments, isLoading: paymentsLoading } = useNostrDonationPayments({
    poll: false,
    enabled: !!session?.nostrHexId
  });

  // Get unique recipient pubkeys for profile fetching
  const recipientPubkeys = useMemo(() => 
    Array.from(new Set(proposals.map(p => p.recipientPubkey))),
    [proposals]
  );
  
  const { profiles } = useNostrProfilesCacheBulk(recipientPubkeys);

  // Process proposals with payment status
  const processedData = useMemo(() => {
    const now = Math.floor(Date.now() / 1000);
    
    // Get paid proposal IDs
    const paidProposalDTags = new Set(payments.map(p => p.proposalDTag));
    const paidProposalEventIds = new Set(payments.map(p => p.proposalEventId));
    
    // Filter for pending (unpaid and not expired)
    const pendingProposals = proposals.filter(p => {
      const isPaid = paidProposalDTags.has(p.d) || paidProposalEventIds.has(p.eventId);
      if (isPaid) return false;
      
      // Check expiration
      if (p.expires && p.expires < now) return false;
      
      return true;
    });

    // Count completed (paid)
    const completedCount = proposals.filter(p => 
      paidProposalDTags.has(p.d) || paidProposalEventIds.has(p.eventId)
    ).length;

    // Map to summary format
    const pendingPayments: UnconditionalPaymentSummary[] = pendingProposals.map(p => {
      const profile = profiles.get(p.recipientPubkey);
      const recipientName = profile?.display_name || profile?.full_name || 
        `${p.recipientPubkey.substring(0, 8)}...`;
      
      const fiatAmount = parseFloat(p.fiatAmount) || 0;
      const lanaAmount = fiatToLana(fiatAmount, p.fiatCurrency);
      
      const isExpired = p.expires ? p.expires < now : false;
      
      return {
        id: p.eventId,
        dTag: p.d,
        service: p.service || 'Unconditional Payment',
        description: p.content || '',
        recipientName,
        recipientPubkey: p.recipientPubkey,
        recipientWallet: p.wallet,
        fiatAmount: p.fiatAmount,
        fiatCurrency: p.fiatCurrency,
        lanaAmount,
        lanaAmountFormatted: formatLana(lanaAmount),
        fiatAmountFormatted: formatCurrency(fiatAmount, p.fiatCurrency),
        createdAt: p.createdAt,
        createdAtFormatted: format(new Date(p.createdAt * 1000), 'MMM d, yyyy'),
        expiresAt: p.expires,
        expiresAtFormatted: p.expires 
          ? format(new Date(p.expires * 1000), 'MMM d, yyyy')
          : undefined,
        isExpired,
        ref: p.ref,
        url: p.url,
        paymentLink: '/unconditional-payment/pending',
      };
    });

    // Sort by creation date (newest first)
    pendingPayments.sort((a, b) => b.createdAt - a.createdAt);

    // Calculate totals
    const totalLanaAmount = pendingPayments.reduce((sum, p) => sum + p.lanaAmount, 0);

    return {
      pendingCount: pendingPayments.length,
      totalLanaAmount,
      totalLanaFormatted: formatLana(totalLanaAmount),
      pendingPayments,
      completedCount,
    };
  }, [proposals, payments, profiles]);

  const isLoading = proposalsLoading || paymentsLoading;

  return {
    unconditionalPayments: processedData,
    isLoading,
  };
}
