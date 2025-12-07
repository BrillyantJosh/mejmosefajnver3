import React, { createContext, useContext, useState, useEffect } from 'react';
import { convertWifToIds } from '@/lib/crypto';
import { SimplePool } from 'nostr-tools';

interface UserSession {
  lanaPrivateKey: string;
  walletId: string;
  nostrHexId: string;
  nostrNpubId: string;
  nostrPrivateKey: string;
  lanaWalletID?: string; // LanaCoins wallet from KIND 0 profile
  lanoshi2lash?: string; // LASH value in lanoshis from KIND 0 profile
  expiresAt: number; // Unix timestamp when session expires
}

interface AuthContextType {
  session: UserSession | null;
  isLoading: boolean;
  login: (wif: string, relays?: string[], rememberMe?: boolean) => Promise<void>;
  logout: () => void;
  refreshSession: () => void;
}

const AuthContext = createContext<AuthContextType | undefined>(undefined);

const SESSION_KEY = 'lana_user_session';

export const AuthProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [session, setSession] = useState<UserSession | null>(null);
  const [isLoading, setIsLoading] = useState(true);

  const isSessionValid = (session: UserSession): boolean => {
    return session.expiresAt > Date.now();
  };

  const refreshSession = () => {
    if (!session) return;
    
    const updatedSession: UserSession = {
      ...session,
      expiresAt: Date.now() + (30 * 24 * 60 * 60 * 1000) // Extend by 30 days
    };
    
    setSession(updatedSession);
    localStorage.setItem(SESSION_KEY, JSON.stringify(updatedSession));
    console.log('Session refreshed, new expiration:', new Date(updatedSession.expiresAt));
  };

  useEffect(() => {
    // Load session from localStorage on mount
    const storedSession = localStorage.getItem(SESSION_KEY);
    if (storedSession) {
      try {
        const parsedSession: UserSession = JSON.parse(storedSession);
        
        // Validate session expiration
        if (isSessionValid(parsedSession)) {
          setSession(parsedSession);
          console.log('Session loaded successfully, expires:', new Date(parsedSession.expiresAt));
        } else {
          console.log('Session expired, removing...');
          localStorage.removeItem(SESSION_KEY);
        }
      } catch (error) {
        console.error('Failed to parse stored session:', error);
        localStorage.removeItem(SESSION_KEY);
      }
    }
    setIsLoading(false);
  }, []);

  const login = async (wif: string, relays?: string[], rememberMe: boolean = false) => {
    try {
      const derivedIds = await convertWifToIds(wif);
      let lanaWalletID: string | undefined = undefined;
      let lanoshi2lash: string | undefined = undefined;
      
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
            
            // Extract lanaWalletID and lanoshi2lash from profile
            try {
              const profileContent = JSON.parse(profileEvent.content);
              if (profileContent.lanaWalletID) {
                lanaWalletID = profileContent.lanaWalletID;
                console.log('LanaWalletID extracted:', profileContent.lanaWalletID);
              }
              if (profileContent.lanoshi2lash) {
                lanoshi2lash = profileContent.lanoshi2lash;
                console.log('lanoshi2lash extracted:', profileContent.lanoshi2lash);
              }
            } catch (e) {
              console.warn('Could not parse profile content:', e);
            }
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
        nostrHexId: derivedIds.nostrHexId,
        nostrNpubId: derivedIds.nostrNpubId,
        nostrPrivateKey: derivedIds.nostrPrivateKey,
        lanaWalletID,
        lanoshi2lash,
        expiresAt
      };
      
      setSession(userSession);
      localStorage.setItem(SESSION_KEY, JSON.stringify(userSession));
      console.log(`Session created, expires in ${expirationDays} days:`, new Date(expiresAt));
    } catch (error) {
      throw new Error(error instanceof Error ? error.message : 'Login failed');
    }
  };

  const logout = () => {
    setSession(null);
    localStorage.removeItem(SESSION_KEY);
  };

  return (
    <AuthContext.Provider value={{ session, isLoading, login, logout, refreshSession }}>
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
