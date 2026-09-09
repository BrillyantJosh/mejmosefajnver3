import { useEffect, useRef } from 'react';
import { useAuth } from '@/contexts/AuthContext';
import { useSystemParameters } from '@/contexts/SystemParametersContext';
import { FrozenOutScreen } from '@/components/FrozenOutScreen';
import { checkGrossViolationFreeze } from '@/lib/ownFreezeGate';

/**
 * Renders the app, unless a commission gross-violation decision stands.
 *
 * It lives here rather than in AuthContext because the check needs BOTH the
 * session and the relay list, and the parameters context already depends on
 * auth — reading relays from storage instead was worse than it looked, since
 * nothing writes them there and the check would have silently never run.
 *
 * Gating only the sign-in would leave every existing session untouched, and
 * those are exactly the people a decision is most likely to reach. So a signed
 * in session is re-checked on mount and every ten minutes; when a decision
 * stands the session ends and nothing of the app renders — no route, no cached
 * view, no partial page.
 */
export const FrozenOutGate = ({ children }: { children: React.ReactNode }) => {
  const { session, frozenOut, setFrozenOut, logout } = useAuth();
  const { parameters } = useSystemParameters();
  const relays = parameters?.relays;
  const busy = useRef(false);

  useEffect(() => {
    const hex = session?.nostrHexId;
    if (!hex || !relays?.length || frozenOut) return;
    let cancelled = false;

    const check = async () => {
      if (busy.current) return;
      busy.current = true;
      try {
        const verdict = await checkGrossViolationFreeze(hex, relays);
        if (!cancelled && verdict.frozen) {
          console.warn('Session ended: a commission gross-violation decision stands');
          // Take the language BEFORE the session ends. Losing it here would
          // switch the page to English at exactly the moment someone most
          // needs to read it in their own.
          setFrozenOut({ ...verdict, lang: session?.profileLang });
          logout();
        }
      } catch {
        // Never end a session because a check FAILED — only because it
        // succeeded and said the person is frozen.
      } finally {
        busy.current = false;
      }
    };

    void check();
    const timer = setInterval(check, 10 * 60 * 1000);
    return () => { cancelled = true; clearInterval(timer); };
  }, [session?.nostrHexId, relays, frozenOut, setFrozenOut, logout]);

  if (frozenOut) return <FrozenOutScreen verdict={frozenOut} onBack={() => setFrozenOut(null)} />;
  return <>{children}</>;
};
