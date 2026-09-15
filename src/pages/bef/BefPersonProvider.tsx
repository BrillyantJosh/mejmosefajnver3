import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { useAuth } from '@/contexts/AuthContext';
import { BefApiError, localExpiryMs, type BefClient, type BefMe, type BefPerson, type BefSession } from '@/lib/bef/api';
import { befClient } from '@/lib/bef/config';
import {
  BEF_TOKEN_KEY,
  clearBefToken,
  parseBefToken,
  peekBefToken,
  readBefToken,
  storeBefToken,
} from '@/lib/bef/personToken';
import { doorProblem, type BefProblem } from '@/lib/bef/problems';
import { befKeyFromSession, register as registerWallet, signIn, type BefKey, type ProfileFields } from '@/lib/bef/signing';

/**
 * The person's BEF Explorer session, for the pages of the BEF module.
 *
 * The person is already logged in to MejmoSefajn with their key, so there is
 * nothing to type: a page that needs BEF (Interest, My Circle) opens
 * <BefDoor>, and the sign-in runs on its own — a stored session for this
 * person is resumed through /me, otherwise a challenge is signed with the
 * MejmoSefajn key and exchanged for a session token, exactly BEF's own person
 * door. The Explorer reads only public figures and never signs in.
 *
 * - One sign-in at a time across tabs (navigator.locks, or one promise at a
 *   time where locks are missing): a tab that waited uses the session another
 *   tab has just stored instead of opening a second one. BEF keeps at most 10
 *   per key.
 * - A sign-in that timed out is never repeated by itself — it may have opened
 *   a session. A refusal waits for Try again; nothing here loops.
 * - Before every signature: the hex of the stored session, of the session this
 *   tab holds, and of the MejmoSefajn session must be the same person.
 * - withSession(fn): a session BEF no longer knows is replaced once (the newer
 *   stored one, or one fresh sign-in) and fn runs once more, signing again with
 *   a fresh created_at.
 * - When BEF says the wallet is not registered, or the key has no profile, the
 *   registration card opens instead (BefRegistration).
 *
 * The provider is keyed by the MejmoSefajn hex (BefLayout), so another account
 * logging in starts it — and every page's state — afresh.
 */

export type RegistrationMode = 'register' | 'registerOnly' | 'profile';

export type BefStage =
  | { kind: 'idle' }
  | { kind: 'checking' }
  | { kind: 'signedIn'; token: string; hex: string; person: BefPerson; expiresAtMs: number }
  /** BEF does not know the wallet, or the key has no profile: the registration card. */
  | { kind: 'register'; mode: RegistrationMode; address: string }
  /** Decided (by the Registrar, the profile, or this session not holding together). */
  | { kind: 'refused'; problem: BefProblem }
  /** Nothing was decided; Try again. */
  | { kind: 'failed'; problem: BefProblem };

type SignedInStage = Extract<BefStage, { kind: 'signedIn' }>;

/** What a signed-in call is handed: the token, the key to sign with, and who BEF says this is. */
export interface BefAuth {
  token: string;
  key: BefKey;
  person: BefPerson;
}

export interface BefPersonContextValue {
  stage: BefStage;
  client: BefClient;
  /** Sign in (or resume) unless that is already done, running, or waiting for Try again. */
  ensureSignedIn: () => void;
  /** After a refusal or a failure: sign in again. */
  retry: () => void;
  /** Run a signed-in call; a session BEF no longer knows is replaced once and fn runs again. */
  withSession: <T>(fn: (auth: BefAuth) => Promise<T>) => Promise<T>;
  /** The registration card's send: Registrar first, then the profile when one is given, then a session. */
  registerWallet: (options: { address: string; profile: ProfileFields | null; lang: string }) => Promise<void>;
  /** The registration card changes its own mode or address (the other address form). */
  setRegistration: (mode: RegistrationMode, address: string) => void;
  /** The wallet's standing changed while registering: leave the card with this reason. */
  leaveRegistration: (problem: BefProblem) => void;
}

const BefPersonContext = createContext<BefPersonContextValue | null>(null);

/** setTimeout's ceiling: a longer delay fires at once. */
const MAX_TIMER_MS = 2_147_483_647;
const LOCK_NAME = 'mejmo-bef-signin';

/** Where navigator.locks is missing, one sign-in at a time in this tab at least. */
let lockQueue: Promise<unknown> = Promise.resolve();
function withSignInLock<T>(fn: () => Promise<T>): Promise<T> {
  if (typeof navigator !== 'undefined' && navigator.locks?.request) {
    return navigator.locks.request(LOCK_NAME, fn) as Promise<T>;
  }
  const run = lockQueue.then(fn, fn);
  lockQueue = run.catch(() => undefined);
  return run;
}

const accountChanged = () => new BefApiError('account_changed', 0);

const isLostSession = (err: unknown) =>
  err instanceof BefApiError && err.status === 401 && (err.code === 'not_signed_in' || err.code === 'session_expired');

export function BefPersonProvider({ children }: { children: ReactNode }) {
  const { session } = useAuth();
  const hex = session?.nostrHexId ?? '';
  const client = befClient;

  const [stage, setStageState] = useState<BefStage>({ kind: 'idle' });
  const stageRef = useRef<BefStage>(stage);
  const setStage = useCallback((next: BefStage) => {
    stageRef.current = next;
    setStageState(next);
  }, []);

  const sessionRef = useRef(session);
  sessionRef.current = session;
  /** Set on unmount: a sign-in finishing afterwards must not store a token for someone who left. */
  const disposed = useRef(false);
  useEffect(() => {
    disposed.current = false;
    return () => {
      disposed.current = true;
    };
  }, []);

  /** The MejmoSefajn session is still this provider's person. */
  const samePerson = useCallback(() => !!hex && sessionRef.current?.nostrHexId === hex, [hex]);

  /** The key to sign with, read from the MejmoSefajn session each time it is needed. */
  const readKey = useCallback(async (): Promise<BefKey> => {
    const current = sessionRef.current;
    if (!current || current.nostrHexId !== hex) throw accountChanged();
    return befKeyFromSession(current);
  }, [hex]);

  /** A session BEF just opened: kept for this person, unless they have left meanwhile. */
  const keep = useCallback(
    (answer: BefSession): SignedInStage => {
      if (answer.hex !== hex) throw accountChanged();
      const expiresAtMs = localExpiryMs(answer.expiresAt, answer.serverTime);
      if (disposed.current || !samePerson()) {
        void client.person.logout(answer.token).catch(() => undefined);
        throw accountChanged();
      }
      storeBefToken({ hex, token: answer.token, expiresAtMs });
      return { kind: 'signedIn', token: answer.token, hex, person: answer.person, expiresAtMs };
    },
    [hex, client, samePerson],
  );

  /**
   * Inside the lock: the session stored for this person, if BEF still knows it,
   * else one sign-in. `stale` is a token already known to be gone.
   */
  const acquire = useCallback(
    (stale: string | null) =>
      withSignInLock(async (): Promise<SignedInStage> => {
        const stored = readBefToken(hex);
        if (stored && stored.token !== stale) {
          let me: BefMe | null = null;
          try {
            me = await client.person.me(stored.token);
          } catch (err) {
            // No answer is said as it is — the stored session may well be fine.
            if (!isLostSession(err)) throw err;
          }
          if (me && me.hex === hex) {
            return { kind: 'signedIn', token: stored.token, hex, person: me.person, expiresAtMs: stored.expiresAtMs };
          }
          // Not known any more, or not this person's: forgotten, and signed in below.
          if (peekBefToken()?.token === stored.token) clearBefToken();
        } else if (stored) {
          clearBefToken();
        }
        const key = await readKey();
        return keep(await signIn(client, key));
      }),
    [hex, client, readKey, keep],
  );

  /** A refusal or failure, said once; registration opens where BEF says so. */
  const settle = useCallback(
    (err: unknown) => {
      if (disposed.current) return;
      if (err instanceof BefApiError && typeof err.body.address === 'string') {
        if (err.code === 'not_registered') {
          setStage({ kind: 'register', mode: err.body.profile === 'found' ? 'registerOnly' : 'register', address: err.body.address });
          return;
        }
        if (err.code === 'profile_missing') {
          setStage({ kind: 'register', mode: 'profile', address: err.body.address });
          return;
        }
      }
      const problem = doorProblem(err);
      setStage(problem.action === 'retry' && problem.code !== 'account_changed' ? { kind: 'failed', problem } : { kind: 'refused', problem });
    },
    [setStage],
  );

  const start = useCallback(() => {
    if (!hex) return;
    setStage({ kind: 'checking' });
    acquire(null).then(
      (signedIn) => {
        if (!disposed.current) setStage(signedIn);
      },
      settle,
    );
  }, [hex, acquire, settle, setStage]);

  const ensureSignedIn = useCallback(() => {
    if (stageRef.current.kind === 'idle') start();
  }, [start]);

  const retry = useCallback(() => {
    const kind = stageRef.current.kind;
    if (kind === 'refused' || kind === 'failed' || kind === 'idle' || kind === 'register') start();
  }, [start]);

  /** The same person everywhere before anything is signed — or nothing is. */
  const authFor = useCallback(
    async (signed: SignedInStage): Promise<BefAuth> => {
      const stored = peekBefToken();
      if (!samePerson() || signed.hex !== hex || (stored && stored.hex !== hex)) {
        const problem = doorProblem(accountChanged());
        setStage({ kind: 'refused', problem });
        throw accountChanged();
      }
      return { token: signed.token, key: await readKey(), person: signed.person };
    },
    [hex, samePerson, readKey, setStage],
  );

  const withSession = useCallback(
    async <T,>(fn: (auth: BefAuth) => Promise<T>): Promise<T> => {
      const current = stageRef.current;
      if (current.kind !== 'signedIn') throw new BefApiError('not_signed_in', 401);
      try {
        return await fn(await authFor(current));
      } catch (err) {
        if (!isLostSession(err)) throw err;
        let fresh: SignedInStage;
        try {
          fresh = await acquire(current.token);
        } catch (signInErr) {
          settle(signInErr);
          throw signInErr;
        }
        if (disposed.current) throw accountChanged();
        setStage(fresh);
        return fn(await authFor(fresh));
      }
    },
    [authFor, acquire, settle, setStage],
  );

  const doRegister = useCallback(
    async (options: { address: string; profile: ProfileFields | null; lang: string }) => {
      const key = await readKey();
      const signedIn = await withSignInLock(async () => keep(await registerWallet(client, key, options)));
      if (!disposed.current) setStage(signedIn);
    },
    [client, readKey, keep, setStage],
  );

  const setRegistration = useCallback(
    (mode: RegistrationMode, address: string) => {
      if (stageRef.current.kind === 'register') setStage({ kind: 'register', mode, address });
    },
    [setStage],
  );

  const leaveRegistration = useCallback(
    (problem: BefProblem) => setStage(problem.action === 'retry' ? { kind: 'failed', problem } : { kind: 'refused', problem }),
    [setStage],
  );

  // The session ends here at its expiry even in a tab left open; a page that
  // still needs BEF signs in again by itself.
  const signedInToken = stage.kind === 'signedIn' ? stage.token : null;
  const signedInExpiry = stage.kind === 'signedIn' ? stage.expiresAtMs : 0;
  useEffect(() => {
    if (!signedInToken) return;
    const timer = setTimeout(() => {
      const current = stageRef.current;
      if (current.kind !== 'signedIn' || current.token !== signedInToken) return;
      if (peekBefToken()?.token === signedInToken) clearBefToken();
      setStage({ kind: 'idle' });
    }, Math.min(MAX_TIMER_MS, Math.max(0, signedInExpiry - Date.now())));
    return () => clearTimeout(timer);
  }, [signedInToken, signedInExpiry, setStage]);

  // Other tabs: a newer session for this person is taken over; a removed one
  // (signed out, or lost there) ends here too; a session another tab opened
  // while this one waits on a card is picked up through the lock.
  useEffect(() => {
    const onStorage = (event: StorageEvent) => {
      if (event.key !== BEF_TOKEN_KEY && event.key !== null) return;
      const record = event.key === null ? null : parseBefToken(event.newValue);
      const current = stageRef.current;
      if (current.kind === 'signedIn') {
        if (!record) setStage({ kind: 'idle' });
        else if (record.hex !== hex) setStage({ kind: 'refused', problem: doorProblem(accountChanged()) });
        else if (record.token !== current.token) setStage({ ...current, token: record.token, expiresAtMs: record.expiresAtMs });
        return;
      }
      if (record?.hex === hex && current.kind !== 'checking' && current.kind !== 'idle') start();
    };
    window.addEventListener('storage', onStorage);
    return () => window.removeEventListener('storage', onStorage);
  }, [hex, start, setStage]);

  const value = useMemo<BefPersonContextValue>(
    () => ({
      stage,
      client,
      ensureSignedIn,
      retry,
      withSession,
      registerWallet: doRegister,
      setRegistration,
      leaveRegistration,
    }),
    [stage, client, ensureSignedIn, retry, withSession, doRegister, setRegistration, leaveRegistration],
  );

  return <BefPersonContext.Provider value={value}>{children}</BefPersonContext.Provider>;
}

export function useBefPerson(): BefPersonContextValue {
  const context = useContext(BefPersonContext);
  if (!context) throw new Error('useBefPerson must be used within a BefPersonProvider');
  return context;
}
