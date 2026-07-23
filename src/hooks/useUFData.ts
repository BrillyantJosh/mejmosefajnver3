/**
 * Unconditional Financing — API types + fetch hooks.
 * All reads go to the server-authoritative REST API at
 * /api/unconditional-financing (mirrors useLanacrowdProjects).
 */
import { useCallback, useEffect, useState } from 'react';

const API_URL = import.meta.env.VITE_API_URL ?? '';
export const UF_API = `${API_URL}/api/unconditional-financing`;

// New Nostr kinds owned by this module (documented on LanaNostr.site)
export const UF_REQUEST_KIND = 31240;      // addressable request
export const UF_CONTRIBUTION_KIND = 60210; // contribution record
export const UF_REPAYMENT_KIND = 60211;    // repayment record
export const UF_COMMENT_KIND = 60212;      // maturing comment / reply

export type UfRequestType = 'personal_hardship' | 'lifestyle_transition' | 'wellbeing_project';
export type UfPhase = 'maturing' | 'repaying' | 'repaid';

export interface UfRequest {
  id: string;               // d-tag: uf:<uuid>
  eventId: string | null;
  pubkey: string;
  title: string;
  shortDesc: string;
  content: string;
  requestType: UfRequestType;
  fiatGoal: number;
  currency: string;
  wallet: string;
  coverImage: string | null;
  galleryImages: string[];
  crowdfundingRefs: string[];
  publishedAt: number;
  fundingOpensAt: number;
  status: string;
  isHidden: boolean;
  isRepaid: boolean;
  phase: UfPhase;
  nostrCreatedAt: number;
  totalFunded: number;
  contributionCount: number;
  financierCount: number;
  totalRepaid: number;
}

export interface UfContribution {
  id: string;
  requestId: string;
  supporterPubkey: string;
  recipientPubkey: string;
  amountLanoshis: number;
  amountFiat: number;
  currency: string;
  rate: number;
  fromWallet: string;
  repaymentWallet: string;
  toWallet: string;
  txId: string | null;
  message: string;
  nostrCreatedAt: number;
}

export interface UfRepaymentOutputRecord {
  pubkey: string;
  wallet: string;
  lanoshis: number;
  fiat: number;
}

export interface UfRepayment {
  id: string;
  requestId: string;
  payerPubkey: string;
  totalLanoshis: number;
  totalFiat: number;
  currency: string;
  rate: number;
  txId: string | null;
  outputs: UfRepaymentOutputRecord[];
  nostrCreatedAt: number;
}

export interface UfFinancier {
  pubkey: string;
  wallet: string;
  amountFiat: number;
  amountLanoshis: number;
  sharePercent: number;
}

export interface UfRequestDetail {
  request: UfRequest;
  contributions: UfContribution[];
  repayments: UfRepayment[];
  financiers: UfFinancier[];
  totalFunded: number;
  totalRepaid: number;
}

export interface UfMySupport {
  request: UfRequest;
  myFiat: number;
  myLanoshis: number;
  sharePercent: number;
  repaidToMe: number;
  outstandingToMe: number;
}

export interface UfMyFinancing {
  request: UfRequest;
  totalFunded: number;
  totalRepaid: number;
  outstanding: number;
}

// ── hooks ──

export function useUfRequests(tab: 'maturing' | 'repaying' | 'repaid' | 'all', page = 1, limit = 20) {
  const [requests, setRequests] = useState<UfRequest[]>([]);
  const [total, setTotal] = useState(0);
  const [totalPages, setTotalPages] = useState(1);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [refreshKey, setRefreshKey] = useState(0);

  useEffect(() => {
    let alive = true;
    setIsLoading(true);
    fetch(`${UF_API}/requests?tab=${tab}&page=${page}&limit=${limit}`)
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error(`HTTP ${r.status}`))))
      .then((d) => {
        if (!alive) return;
        setRequests(d.requests || []);
        setTotal(d.total || 0);
        setTotalPages(d.totalPages || 1);
        setError(null);
      })
      .catch((e) => alive && setError(e.message))
      .finally(() => alive && setIsLoading(false));
    return () => { alive = false; };
  }, [tab, page, limit, refreshKey]);

  const refetch = useCallback(() => setRefreshKey((k) => k + 1), []);
  return { requests, total, totalPages, isLoading, error, refetch };
}

export function useUfRequest(id: string | undefined) {
  const [detail, setDetail] = useState<UfRequestDetail | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [refreshKey, setRefreshKey] = useState(0);

  useEffect(() => {
    if (!id) { setIsLoading(false); return; }
    let alive = true;
    setIsLoading(true);
    fetch(`${UF_API}/requests/${encodeURIComponent(id)}`)
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error(`HTTP ${r.status}`))))
      .then((d) => { if (alive) { setDetail(d); setError(null); } })
      .catch((e) => alive && setError(e.message))
      .finally(() => alive && setIsLoading(false));
    return () => { alive = false; };
  }, [id, refreshKey]);

  const refetch = useCallback(() => setRefreshKey((k) => k + 1), []);
  return { detail, isLoading, error, refetch };
}

export function useUfMySupports(pubkey: string | undefined) {
  const [supports, setSupports] = useState<UfMySupport[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [refreshKey, setRefreshKey] = useState(0);

  useEffect(() => {
    if (!pubkey) { setIsLoading(false); return; }
    let alive = true;
    setIsLoading(true);
    fetch(`${UF_API}/my-supports/${encodeURIComponent(pubkey)}`)
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error(`HTTP ${r.status}`))))
      .then((d) => alive && setSupports(d.supports || []))
      .catch(() => {})
      .finally(() => alive && setIsLoading(false));
    return () => { alive = false; };
  }, [pubkey, refreshKey]);

  const refetch = useCallback(() => setRefreshKey((k) => k + 1), []);
  return { supports, isLoading, refetch };
}

export function useUfMyFinancings(pubkey: string | undefined) {
  const [financings, setFinancings] = useState<UfMyFinancing[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [refreshKey, setRefreshKey] = useState(0);

  useEffect(() => {
    if (!pubkey) { setIsLoading(false); return; }
    let alive = true;
    setIsLoading(true);
    fetch(`${UF_API}/my-financings/${encodeURIComponent(pubkey)}`)
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error(`HTTP ${r.status}`))))
      .then((d) => alive && setFinancings(d.financings || []))
      .catch(() => {})
      .finally(() => alive && setIsLoading(false));
    return () => { alive = false; };
  }, [pubkey, refreshKey]);

  const refetch = useCallback(() => setRefreshKey((k) => k + 1), []);
  return { financings, isLoading, refetch };
}

// ── shared display helpers ──

/** Bilingual labels for the three request types (EN default, SL when sl). */
export function ufTypeLabel(type: UfRequestType, sl: boolean): string {
  switch (type) {
    case 'personal_hardship':
      return sl ? 'Reševanje osebne stiske' : 'Personal hardship';
    case 'lifestyle_transition':
      return sl ? 'Prehod v bolj naraven življenjski slog' : 'Natural-lifestyle transition';
    case 'wellbeing_project':
      return sl ? 'Projekt za skupno dobro' : 'Well-being project';
    default:
      return type;
  }
}

/** Days (rounded up) until funding opens; 0 when already open. */
export function ufMaturingDaysLeft(fundingOpensAt: number): number {
  const secs = fundingOpensAt - Math.floor(Date.now() / 1000);
  return secs > 0 ? Math.ceil(secs / 86400) : 0;
}
