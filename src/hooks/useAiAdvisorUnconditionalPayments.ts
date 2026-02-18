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
  
  // Fetch proposals for the current user (with polling for fresh data)
  const { proposals, isLoading: proposalsLoading } = useNostrDonationProposals(
    session?.nostrHexId,
    { poll: true, pollIntervalMs: 15000, enabled: !!session?.nostrHexId }
  );
  
  // Fetch payments to check which are already paid (with polling)
  const { payments, isLoading: paymentsLoading } = useNostrDonationPayments(
    session?.nostrHexId,
    {
      poll: true,
      pollIntervalMs: 15000,
      enabled: !!session?.nostrHexId
    }
  );

  // Debug logging moved to inside processedData useMemo

  // Get unique recipient pubkeys for profile fetching
  const recipientPubkeys = useMemo(() => 
    Array.from(new Set(proposals.map(p => p.recipientPubkey))),
    [proposals]
  );
  
  const { profiles } = useNostrProfilesCacheBulk(recipientPubkeys);

  // Process proposals with payment status
  const processedData = useMemo(() => {
    const now = Math.floor(Date.now() / 1000);
    
    // Get list of this user's proposal identifiers (d-tags and event IDs)
    const userProposalDTags = new Set(proposals.map(p => p.d));
    const userProposalEventIds = new Set(proposals.map(p => p.eventId));
    
    // Filter payments to only those that match user's proposals
    const relevantPayments = payments.filter(p => 
      userProposalDTags.has(p.proposalDTag) || userProposalEventIds.has(p.proposalEventId)
    );
    
    // Get paid proposal IDs from relevant payments only
    const paidProposalDTags = new Set(relevantPayments.map(p => p.proposalDTag));
    const paidProposalEventIds = new Set(relevantPayments.map(p => p.proposalEventId));
    
    console.log(`📋 Unconditional Payments: ${proposals.length} proposals, ${relevantPayments.length} relevant payments (of ${payments.length} total)`);
    
    // Filter for pending (unpaid) - DO NOT filter by expiration to match Pending.tsx behavior
    // Each item will have isExpired flag for display purposes
    const pendingProposals = proposals.filter(p => {
      const isPaid = paidProposalDTags.has(p.d) || paidProposalEventIds.has(p.eventId);
      return !isPaid;
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
