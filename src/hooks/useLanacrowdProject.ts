import { useState, useEffect, useCallback } from 'react';
import { LanacrowdProject } from './useLanacrowdProjects';

export interface LanacrowdDonation {
  id: string;
  projectId: string;
  supporterPubkey: string;
  projectOwnerPubkey: string;
  amountLanoshis: number;
  amountFiat: number;
  currency: string;
  fromWallet: string;
  toWallet: string;
  txId?: string;
  nostrCreatedAt: number;
  createdAt: string;
}

export function useLanacrowdProject(projectId: string | undefined) {
  const [project, setProject] = useState<LanacrowdProject | null>(null);
  const [donations, setDonations] = useState<LanacrowdDonation[]>([]);
  const [totalRaised, setTotalRaised] = useState(0);
  const [donationCount, setDonationCount] = useState(0);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const fetchProject = useCallback(async () => {
    if (!projectId) { setIsLoading(false); return; }
    setIsLoading(true);
    setError(null);
    try {
      const [projRes, donRes] = await Promise.all([
        window.fetch(`/api/lanacrowd/projects/${encodeURIComponent(projectId)}`),
        window.fetch(`/api/lanacrowd/donations/${encodeURIComponent(projectId)}`),
      ]);

      if (!projRes.ok) throw new Error(`Project not found (HTTP ${projRes.status})`);
      const projJson = await projRes.json();
      setProject(projJson.project);
      setTotalRaised(projJson.project?.totalRaised ?? 0);
      setDonationCount(projJson.project?.donationCount ?? 0);

      if (donRes.ok) {
        const donJson = await donRes.json();
        setDonations(donJson.donations || []);
        setTotalRaised(donJson.totalRaised ?? projJson.project?.totalRaised ?? 0);
      }
    } catch (err: any) {
      console.error('useLanacrowdProject error:', err);
      setError(err.message || 'Failed to load project');
    } finally {
      setIsLoading(false);
    }
  }, [projectId]);

  useEffect(() => { fetchProject(); }, [fetchProject]);

  return { project, donations, totalRaised, donationCount, isLoading, error, refetch: fetchProject };
}
