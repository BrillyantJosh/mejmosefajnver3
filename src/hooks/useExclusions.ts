import { useEffect, useState } from 'react';
import { useSystemParameters } from '@/contexts/SystemParametersContext';
import { listActiveExclusions, type Exclusion } from '@/lib/ownExclusion';

/**
 * Everyone a commission has excluded, keyed by pubkey.
 *
 * One query for the whole screen rather than one per name: a list of thirty
 * people would otherwise open thirty relay queries to answer the same question.
 */
export const useExclusions = () => {
  const { parameters } = useSystemParameters();
  const relays = parameters?.relays;
  const split = parameters?.split != null ? Number(parameters.split) : null;

  const [byPerson, setByPerson] = useState<Record<string, Exclusion>>({});
  const [list, setList] = useState<Exclusion[]>([]);
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    if (!relays?.length) return;
    let cancelled = false;

    (async () => {
      setIsLoading(true);
      const found = await listActiveExclusions(relays, Number.isFinite(split) ? split : null);
      if (cancelled) return;
      setList(found);
      setByPerson(Object.fromEntries(found.map((e) => [e.personHex, e])));
      setIsLoading(false);
    })();

    return () => { cancelled = true; };
  }, [relays, split]);

  return { exclusions: list, exclusionOf: byPerson, isLoading };
};
