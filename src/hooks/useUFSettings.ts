import { useEffect, useState } from "react";
import { UF_API } from "@/hooks/useUFData";
import {
  UF_DEFAULT_MATURING_DAYS,
  UF_DEFAULT_MAX_AMOUNTS,
  type UfMaxAmounts,
} from "@/lib/ufSettings";

export interface UfSettings {
  maturingDays: number;
  maxAmounts: UfMaxAmounts;
}

/**
 * The module rules the SERVER enforces (maturing length, per-group caps).
 * Read from the module API rather than the client-side settings cache so the
 * form can never promise a window or a cap the server would not honour.
 * Falls back to the shipped defaults while loading or if the call fails.
 */
export function useUfSettings() {
  const [settings, setSettings] = useState<UfSettings>({
    maturingDays: UF_DEFAULT_MATURING_DAYS,
    maxAmounts: UF_DEFAULT_MAX_AMOUNTS,
  });
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    let alive = true;
    fetch(`${UF_API}/settings`)
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error(`HTTP ${r.status}`))))
      .then((d) => {
        if (!alive) return;
        const days = Number(d?.maturingDays);
        setSettings({
          maturingDays: Number.isFinite(days) && days >= 0 ? days : UF_DEFAULT_MATURING_DAYS,
          maxAmounts: { ...UF_DEFAULT_MAX_AMOUNTS, ...(d?.maxAmounts || {}) },
        });
      })
      .catch(() => {
        /* keep defaults — the server still enforces the real values */
      })
      .finally(() => alive && setIsLoading(false));
    return () => {
      alive = false;
    };
  }, []);

  return { settings, isLoading };
}
