import { useState, useEffect, useCallback } from 'react';
import { LanacrowdProject } from './useLanacrowdProjects';
import { useAuth } from '@/contexts/AuthContext';

export function useMyLanacrowdProjects() {
  const { session } = useAuth();
  const pubkey = session?.nostrHexId;

  const [projects, setProjects] = useState<LanacrowdProject[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const fetch = useCallback(async () => {
    if (!pubkey) { setIsLoading(false); return; }
    setIsLoading(true);
    setError(null);
    try {
      const res = await window.fetch(`/api/lanacrowd/my-projects/${encodeURIComponent(pubkey)}`);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const json = await res.json();
      setProjects(json.projects || []);
    } catch (err: any) {
      console.error('useMyLanacrowdProjects error:', err);
      setError(err.message || 'Failed to load your projects');
    } finally {
      setIsLoading(false);
    }
  }, [pubkey]);

  useEffect(() => { fetch(); }, [fetch]);

  return { projects, isLoading, error, refetch: fetch };
}
