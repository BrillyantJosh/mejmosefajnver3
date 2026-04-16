import { useState, useCallback } from 'react';
import { useAuth } from '@/contexts/AuthContext';
import { convertWifToIds } from '@/lib/crypto';

export interface Being {
  nostrHexId: string;
  name?: string;
  addedAt: number;
}

const SOZITJE_PUBKEY = '83350f1fb5124f0472a2ddc37805062e79a1262e5c3d3a837e76d07a0653abc8';

function getStorageKey(userHexId: string): string {
  return `my_beings_${userHexId}`;
}

function loadBeings(userHexId: string): Being[] {
  try {
    const raw = localStorage.getItem(getStorageKey(userHexId));
    if (!raw) return [];
    return JSON.parse(raw);
  } catch {
    return [];
  }
}

function saveBeings(userHexId: string, beings: Being[]) {
  localStorage.setItem(getStorageKey(userHexId), JSON.stringify(beings));
}

export function useMyBeings() {
  const { session } = useAuth();
  const userHexId = session?.nostrHexId || '';

  const [beings, setBeings] = useState<Being[]>(() => loadBeings(userHexId));

  // Sožitje is always the first being (default, can't be removed)
  const allBeings: Being[] = [
    { nostrHexId: SOZITJE_PUBKEY, name: 'Sožitje', addedAt: 0 },
    ...beings.filter(b => b.nostrHexId !== SOZITJE_PUBKEY),
  ];

  const addBeing = useCallback((wif: string, customName?: string): { success: boolean; error?: string; hexId?: string } => {
    if (!userHexId) return { success: false, error: 'Not authenticated' };

    try {
      const ids = convertWifToIds(wif);
      const hexId = ids.nostrHexId;

      if (!hexId || hexId.length !== 64) {
        return { success: false, error: 'Could not derive Nostr ID from WIF' };
      }

      // Check duplicates
      if (hexId === SOZITJE_PUBKEY) {
        return { success: false, error: 'Sožitje is already in your list' };
      }
      const current = loadBeings(userHexId);
      if (current.find(b => b.nostrHexId === hexId)) {
        return { success: false, error: 'This being is already added' };
      }

      const newBeing: Being = {
        nostrHexId: hexId,
        name: customName || undefined,
        addedAt: Date.now(),
      };

      const updated = [...current, newBeing];
      saveBeings(userHexId, updated);
      setBeings(updated);

      return { success: true, hexId };
    } catch (err: any) {
      return { success: false, error: err.message || 'Invalid WIF key' };
    }
  }, [userHexId]);

  const removeBeing = useCallback((hexId: string) => {
    if (!userHexId || hexId === SOZITJE_PUBKEY) return;
    const current = loadBeings(userHexId);
    const updated = current.filter(b => b.nostrHexId !== hexId);
    saveBeings(userHexId, updated);
    setBeings(updated);
  }, [userHexId]);

  return { beings: allBeings, addBeing, removeBeing };
}
