import React, { createContext, useContext, useState, useEffect, useCallback } from 'react';
import { checkGrossViolationFreeze, FrozenOutError, type FreezeVerdict } from '@/lib/ownFreezeGate';
import { convertWifToIds } from '@/lib/crypto';
import { befClient } from '@/lib/bef/config';
import { forgetBefPerson } from '@/lib/bef/personToken';
import { SimplePool } from 'nostr-tools';
import { newestOwnProfile, sessionProfileFromKind0, withProfile, type ProfileEvent, type SessionProfileFields } from '@/lib/sessionProfile';

// TypeScript declaration for document.wasDiscarded (Chrome Memory Saver feature)
declare global {
  interface Document {
    wasDiscarded?: boolean;
  }
}

interface UserSession {
  lanaPrivateKey: string;
  walletId: string; // Primary address matching WIF type
  walletIdCompressed?: string; // Always the compressed address
  walletIdUncompressed?: string; // Always the uncompressed address
  isCompressed?: boolean; // true = Staking (T-prefix), false = Dominate (6-prefix)
  nostrHexId: string;
  nostrNpubId: string;
  nostrPrivateKey: string;
  lanaWalletID?: string; // LanaCoins wallet from KIND 0 profile
  lanoshi2lash?: string; // LASH value in lanoshis from KIND 0 profile
  profileName?: string; // User name from KIND 0 profile
  profileDisplayName?: string; // Display name from KIND 0 profile
  profileLang?: string; // Language from KIND 0 profile
  profileCountry?: string; // Country code from KIND 0 profile
  profileCurrency?: string; // Currency from KIND 0 profile
  profileEventAt?: number; // created_at of the KIND 0 the profile fields were read from
  expiresAt: number; // Unix timestamp when session expires
}

interface AuthContextType {
  session: UserSession | null;
  isLoading: boolean;
  login: (wif: string, relays?: string[], rememberMe?: boolean) => Promise<void>;
  logout: () => void;
  refreshSession: () => void;
  /**
   * Hand the session a KIND 0 of the signed-in person — one just published, or
   * one read from the relays. Only a newer one changes anything.
   */
  applyProfileEvent: (event: ProfileEvent) => void;
  /** Set when a commission decision stands; the app renders nothing else. */
  frozenOut: FreezeVerdict | null;
  setFrozenOut: (v: FreezeVerdict | null) => void;
}

const AuthContext = createContext<AuthContextType | undefined>(undefined);

const SESSION_KEY = 'lana_user_session';
const API_URL = import.meta.env.VITE_API_URL ?? '';
const PROFILE_REFRESH_EVERY_MS = 10 * 60 * 1000;

export const AuthProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [session, setSession] = useState<UserSession | null>(null);
  const [frozenOut, setFrozenOut] = useState<FreezeVerdict | null>(null);
  const [isLoading, setIsLoading] = useState(true);

  const isSessionValid = (session: UserSession): boolean => {
    return session.expiresAt > Date.now();
  };

  const refreshSession = useCallback(() => {
    if (!session) return;
    
    const updatedSession: UserSession = {
      ...session,
      expiresAt: Date.now() + (30 * 24 * 60 * 60 * 1000) // Extend by 30 days
    };
    
    setSession(updatedSession);
    try {
      localStorage.setItem(SESSION_KEY, JSON.stringify(updatedSession));
      console.log('Session refreshed, new expiration:', new Date(updatedSession.expiresAt));
    } catch (e) {
      console.warn('Failed to save refreshed session to localStorage:', e);
    }
  }, [session]);

  // Helper function to load session from localStorage
  const loadSessionFromStorage = useCallback((): UserSession | null => {
    try {
      const storedSession = localStorage.getItem(SESSION_KEY);
      if (storedSession) {
        const parsedSession: UserSession = JSON.parse(storedSession);
        if (isSessionValid(parsedSession)) {
          return parsedSession;
        } else {
          console.log('Session expired, removing...');
          localStorage.removeItem(SESSION_KEY);
          // No MejmoSefajn session, no BEF Explorer session opened with its key.
          forgetBefPerson(befClient);
        }
      }
    } catch (error) {
      console.error('Failed to parse stored session:', error);
      // Don't remove on parse error - might be temporary issue
    }
    return null;
  }, []);

  // Load session from localStorage on mount
  useEffect(() => {
    const loadedSession = loadSessionFromStorage();
    if (loadedSession) {
      setSession(loadedSession);
      console.log('Session loaded successfully, expires:', new Date(loadedSession.expiresAt));
    }
    setIsLoading(false);
  }, [loadSessionFromStorage]);



  // Handle Chrome Memory Saver - detect if tab was discarded and restore session
  useEffect(() => {
    if (document.wasDiscarded) {
      console.log('Tab was discarded by Chrome Memory Saver, restoring session...');
      const loadedSession = loadSessionFromStorage();
      if (loadedSession) {
        setSession(loadedSession);
        console.log('Session restored after tab discard');
      }
    }
  }, [loadSessionFromStorage]);

  // Save session to localStorage when tab goes to background (prevents data loss on discard)
  useEffect(() => {
    const handleVisibilityChange = () => {
      if (document.visibilityState === 'hidden' && session) {
        try {
          localStorage.setItem(SESSION_KEY, JSON.stringify(session));
          console.log('Session saved before tab went to background');
        } catch (e) {
          console.warn('Failed to save session on visibility change:', e);
        }
      }
    };

    document.addEventListener('visibilitychange', handleVisibilityChange);
    return () => document.removeEventListener('visibilitychange', handleVisibilityChange);
  }, [session]);

  // Cross-tab session synchronization
  useEffect(() => {
    const handleStorageChange = (event: StorageEvent) => {
      if (event.key === SESSION_KEY) {
        if (event.newValue === null) {
          // User logged out in another tab
          console.log('Session cleared in another tab, logging out...');
          setSession(null);
        } else {
          // Session updated in another tab
          try {
            const updatedSession: UserSession = JSON.parse(event.newValue);
            if (isSessionValid(updatedSession)) {
              setSession(updatedSession);
              console.log('Session synced from another tab');
            }
          } catch (e) {
            console.error('Failed to sync session from storage event:', e);
          }
        }
      }
    };

    window.addEventListener('storage', handleStorageChange);
    return () => window.removeEventListener('storage', handleStorageChange);
  }, []);

  const applyProfileEvent = useCallback((event: ProfileEvent) => {
    setSession((current) => (current ? withProfile(current, event) : current));
  }, []);

  // A refreshed profile is written back, so the next visit — and every other
  // tab — starts from the newer reading.
  useEffect(() => {
    if (!session || session.profileEventAt === undefined) return;
    try {
      localStorage.setItem(SESSION_KEY, JSON.stringify(session));
    } catch (e) {
      console.warn('Failed to save refreshed profile to localStorage:', e);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [session?.profileEventAt]);

  // The profile was read once, at sign-in, and kept for the whole session: a
  // language chosen later — here or in any other Lana app — never arrived. It
  // is read again when the app opens and when the person comes back to it (at
  // most every 10 minutes). The Profile page hands over what it has just
  // published at once, without waiting for this.
  useEffect(() => {
    const hexId = session?.nostrHexId;
    if (!hexId) return;
    let stopped = false;
    let lastCheck = 0;

    const check = async () => {
      if (stopped || Date.now() - lastCheck < PROFILE_REFRESH_EVERY_MS) return;
      lastCheck = Date.now();
      try {
        const res = await fetch(`${API_URL}/api/functions/query-nostr-events`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ filter: { kinds: [0], authors: [hexId], limit: 10 }, timeout: 8000 }),
        });
        if (!res.ok || stopped) return;
        const body = await res.json();
        const newest = newestOwnProfile(body?.events, hexId);
        if (newest && !stopped) applyProfileEvent(newest);
      } catch {
        // Offline, or no relay answered: the session keeps what it has.
      }
    };

    void check();
    const onVisible = () => {
      if (document.visibilityState === 'visible') void check();
    };
    document.addEventListener('visibilitychange', onVisible);
    return () => {
      stopped = true;
      document.removeEventListener('visibilitychange', onVisible);
    };
  }, [session?.nostrHexId, applyProfileEvent]);

  const login = async (wif: string, relays?: string[], rememberMe: boolean = false) => {
    try {
      const derivedIds = await convertWifToIds(wif);

      // A commission gross-violation decision closes the door BEFORE a session
      // exists. Checking after login would leave the account reachable for as
      // long as it took a screen to render — and the point of the sanction is
      // that the contents are not reachable at all.
      const gate = await checkGrossViolationFreeze(derivedIds.nostrHexId, relays ?? []);
      if (gate.frozen) {
        console.warn('Sign-in refused: commission gross-violation decision stands');
        throw new FrozenOutError(gate);
      }
      let profileFields: SessionProfileFields = {};
      let profileEventAt: number | undefined = undefined;
      
      // Check if user has a KIND 0 profile on relays
      if (relays && relays.length > 0) {
        const pool = new SimplePool();
        let profileFound = false;
        
        try {
          console.log('Checking for KIND 0 profile on relays...');
          
          // Create timeout promise
          const timeoutPromise = new Promise<null>((_, reject) => 
            setTimeout(() => reject(new Error('TIMEOUT')), 5000)
          );
          
          // Get profile with timeout
          const profileEvent = await Promise.race([
            pool.get(relays, {
              kinds: [0],
              authors: [derivedIds.nostrHexId],
              limit: 1
            }),
            timeoutPromise
          ]);

          // Check if profile was actually found
          if (profileEvent && profileEvent.kind === 0) {
            console.log('KIND 0 profile found');
            profileFound = true;
            
            // The same reading every later refresh of the session uses.
            profileFields = sessionProfileFromKind0(profileEvent);
            profileEventAt = profileEvent.created_at;
            console.log('Profile read:', {
              lanaWalletID: profileFields.lanaWalletID,
              lang: profileFields.profileLang,
              country: profileFields.profileCountry,
              currency: profileFields.profileCurrency,
            });
          } else {
            console.log('KIND 0 profile not found (null result)');
            profileFound = false;
          }
          
        } catch (profileError) {
          console.error('Profile check error:', profileError);
          
          if (profileError instanceof Error) {
            if (profileError.message === 'TIMEOUT') {
              pool.close(relays);
              throw new Error('Unable to verify profile. Network timeout. Please try again.');
            }
          }
          
          // Any other error means profile check failed
          profileFound = false;
        } finally {
          pool.close(relays);
        }
        
        // Reject login if profile was not found
        if (!profileFound) {
          throw new Error('Profile not found. Please create your profile first.');
        }
      }
      
      // Calculate expiration: 30 days default, 90 days if "remember me"
      const expirationDays = rememberMe ? 90 : 30;
      const expiresAt = Date.now() + (expirationDays * 24 * 60 * 60 * 1000);
      
      const userSession: UserSession = {
        lanaPrivateKey: derivedIds.lanaPrivateKey,
        walletId: derivedIds.walletId,
        walletIdCompressed: derivedIds.walletIdCompressed,
        walletIdUncompressed: derivedIds.walletIdUncompressed,
        isCompressed: derivedIds.isCompressed,
        nostrHexId: derivedIds.nostrHexId,
        nostrNpubId: derivedIds.nostrNpubId,
        nostrPrivateKey: derivedIds.nostrPrivateKey,
        ...profileFields,
        profileEventAt,
        expiresAt
      };
      
      setSession(userSession);
      localStorage.setItem(SESSION_KEY, JSON.stringify(userSession));
      console.log(`Session created, expires in ${expirationDays} days:`, new Date(expiresAt));
    } catch (error) {
      // A commission decision must reach the caller INTACT. Re-wrapping every
      // failure in a plain Error kept only the message, so the typed error and
      // the decision it carries were lost — the caller saw a generic "login
      // error" toast where it should have shown the person what was decided.
      if (error instanceof FrozenOutError) throw error;
      throw new Error(error instanceof Error ? error.message : 'Login failed');
    }
  };

  const logout = () => {
    setSession(null);
    localStorage.removeItem(SESSION_KEY);
    // After the session key, so other tabs leave the app before they see the
    // BEF token go — never signing in to BEF again on the way out.
    forgetBefPerson(befClient);
  };

  return (
    <AuthContext.Provider value={{ session, isLoading, login, logout, refreshSession, applyProfileEvent, frozenOut, setFrozenOut }}>
      {children}
    </AuthContext.Provider>
  );
};

export const useAuth = () => {
  const context = useContext(AuthContext);
  if (context === undefined) {
    throw new Error('useAuth must be used within an AuthProvider');
  }
  return context;
};
