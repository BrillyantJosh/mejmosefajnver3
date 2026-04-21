import { useState, useEffect, useCallback } from 'react';

export type ProjectFilter = 'open' | 'funded' | 'completed' | 'all';

export interface LanacrowdProject {
  id: string;
  eventId: string | null;
  pubkey: string;
  ownerPubkey: string;
  title: string;
  shortDesc: string;
  content: string;
  fiatGoal: number;
  currency: string;
  wallet: string;
  responsibilityStatement: string;
  projectType: string;
  whatType?: string;
  status: 'draft' | 'active';
  coverImage?: string;
  galleryImages: string[];
  videos: string[];
  files: string[];
  participants: string[];
  isHidden: boolean;
  isApproved: boolean;
  isFunded: boolean;
  isCompleted: boolean;
  completionComment?: string;
  nostrCreatedAt: number;
  createdAt: string;
  updatedAt: string;
  totalRaised: number;
  donationCount: number;
}

export interface ProjectsResponse {
  projects: LanacrowdProject[];
  total: number;
  page: number;
  totalPages: number;
}

export function useLanacrowdProjects(
  filter: ProjectFilter = 'open',
  page: number = 1,
  search: string = '',
  adminPubkey?: string,
) {
  const [data, setData] = useState<ProjectsResponse>({
    projects: [], total: 0, page: 1, totalPages: 1
  });
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const fetch = useCallback(async () => {
    setIsLoading(true);
    setError(null);
    try {
      const params = new URLSearchParams({
        filter,
        page: String(page),
        limit: '20',
      });
      if (search) params.set('search', search);
      if (adminPubkey) params.set('adminPubkey', adminPubkey);

      const res = await window.fetch(`/api/lanacrowd/projects?${params}`);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const json = await res.json();
      setData(json);
    } catch (err: any) {
      console.error('useLanacrowdProjects error:', err);
      setError(err.message || 'Failed to load projects');
    } finally {
      setIsLoading(false);
    }
  }, [filter, page, search, adminPubkey]);

  useEffect(() => { fetch(); }, [fetch]);

  return { ...data, isLoading, error, refetch: fetch };
}
