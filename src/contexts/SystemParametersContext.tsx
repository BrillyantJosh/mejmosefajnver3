import React, { createContext, useContext, useState, useEffect } from 'react';
import { SimplePool, Filter, Event } from 'nostr-tools';

const AUTHORIZED_PUBKEY = '9eb71bf1e9c3189c78800e4c3831c1c1a93ab43b61118818c32e4490891a35b3';

interface ElectrumServer {
  host: string;
  port: string;
}

interface ExchangeRates {
  EUR: number;
  USD: number;
  GBP: number;
}

interface RelayStatus {
  url: string;
  connected: boolean;
  responseTime?: number;
}

interface TrustedSigners {
  [key: string]: string[];
}

interface SystemParameters {
  relays: string[];
  relayStatuses: RelayStatus[];
  electrumServers: ElectrumServer[];
  exchangeRates: ExchangeRates;
  split: string;
  version: string;
  validFrom: string;
  connectedRelays: number;
  isLoading: boolean;
  trustedSigners: TrustedSigners;
}

interface SystemParametersContextType {
  parameters: SystemParameters | null;
  isLoading: boolean;
  refetch: () => Promise<void>;
}

const SystemParametersContext = createContext<SystemParametersContextType | undefined>(undefined);

const DEFAULT_RELAYS = [
  'wss://relay.lanavault.space',
  'wss://relay.lanacoin-eternity.com',
  'wss://relay.lanaheartvoice.com'
];

export const SystemParametersProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [parameters, setParameters] = useState<SystemParameters | null>(null);
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    fetchSystemParameters();
  }, []);

  const fetchSystemParameters = async () => {
    const pool = new SimplePool();
    let connectedCount = 0;

    try {
      console.log('Fetching KIND 38888 from relays...');

      const filter: Filter = {
        kinds: [38888],
        authors: [AUTHORIZED_PUBKEY],
        '#d': ['main'],
        limit: 1
      };

      // Connect to relays and fetch event
      const event = await Promise.race([
        pool.get(DEFAULT_RELAYS, filter),
        new Promise<Event | null>((_, reject) => 
          setTimeout(() => reject(new Error('Timeout')), 10000)
        )
      ]) as Event | null;

      if (!event) {
        throw new Error('No KIND 38888 event found');
      }

      console.log('KIND 38888 event received:', event);

      // Verify the event is from authorized pubkey
      if (event.pubkey !== AUTHORIZED_PUBKEY) {
        throw new Error('Unauthorized pubkey');
      }

      // Parse tags
      const relays = event.tags
        .filter(t => t[0] === 'relay')
        .map(t => t[1]);

      const electrumServers = event.tags
        .filter(t => t[0] === 'electrum')
        .map(t => ({ host: t[1], port: t[2] }));

      const fxTags = event.tags.filter(t => t[0] === 'fx');
      const exchangeRates: ExchangeRates = {
        EUR: parseFloat(fxTags.find(t => t[1] === 'EUR')?.[2] || '0'),
        USD: parseFloat(fxTags.find(t => t[1] === 'USD')?.[2] || '0'),
        GBP: parseFloat(fxTags.find(t => t[1] === 'GBP')?.[2] || '0')
      };

      const split = event.tags.find(t => t[0] === 'split')?.[1] || '';
      const version = event.tags.find(t => t[0] === 'version')?.[1] || '';
      const validFrom = event.tags.find(t => t[0] === 'valid_from')?.[1] || '';

      // Parse content for trusted_signers
      let trustedSigners: TrustedSigners = {};
      try {
        if (event.content) {
          const contentData = JSON.parse(event.content);
          trustedSigners = contentData.trusted_signers || {};
        }
      } catch (error) {
        console.warn('Failed to parse event content for trusted_signers:', error);
      }

      // Test relay connections with WebSocket (more reliable than event fetching)
      console.log('Testing relay connections with WebSocket...');
      const relayStatuses: RelayStatus[] = await Promise.all(
        relays.map(async (relayUrl) => {
          const startTime = Date.now();
          try {
            return await new Promise<RelayStatus>((resolve) => {
              const ws = new WebSocket(relayUrl);
              
              const timeout = setTimeout(() => {
                ws.close();
                console.warn(`❌ Relay ${relayUrl} connection timeout`);
                resolve({
                  url: relayUrl,
                  connected: false
                });
              }, 5000);

              ws.onopen = () => {
                clearTimeout(timeout);
                const responseTime = Date.now() - startTime;
                console.log(`✅ Relay ${relayUrl} connected in ${responseTime}ms`);
                ws.close();
                resolve({
                  url: relayUrl,
                  connected: true,
                  responseTime
                });
              };

              ws.onerror = (error) => {
                clearTimeout(timeout);
                console.warn(`❌ Relay ${relayUrl} failed to connect:`, error);
                resolve({
                  url: relayUrl,
                  connected: false
                });
              };
            });
          } catch (error) {
            console.warn(`❌ Relay ${relayUrl} connection error:`, error);
            return {
              url: relayUrl,
              connected: false
            };
          }
        })
      );

      connectedCount = relayStatuses.filter(r => r.connected).length;
      console.log(`Total connected relays: ${connectedCount}/${relays.length}`);

      setParameters({
        relays,
        relayStatuses,
        electrumServers,
        exchangeRates,
        split,
        version,
        validFrom,
        connectedRelays: connectedCount,
        isLoading: false,
        trustedSigners
      });

      // Store in sessionStorage
      sessionStorage.setItem('lana_system_parameters', JSON.stringify({
        relays,
        relayStatuses,
        electrumServers,
        exchangeRates,
        split,
        version,
        validFrom,
        connectedRelays: connectedCount,
        trustedSigners
      }));

    } catch (error) {
      console.error('❌ Error fetching system parameters:', error);
      
      // Try to load from sessionStorage
      const cached = sessionStorage.getItem('lana_system_parameters');
      if (cached) {
        console.log('📦 Using cached system parameters');
        const cachedData = JSON.parse(cached);
        setParameters({ ...cachedData, isLoading: false });
      } else {
        // NO FALLBACK - If relays don't work, don't show mock data
        console.error('❌ Cannot connect to relays and no cached data available');
        setParameters(null);
        
        // Retry after 10 seconds
        console.log('🔄 Retrying connection in 10 seconds...');
        setTimeout(() => {
          console.log('🔄 Retrying connection...');
          fetchSystemParameters();
        }, 10000);
      }
    } finally {
      setIsLoading(false);
      pool.close(DEFAULT_RELAYS);
    }
  };

  return (
    <SystemParametersContext.Provider value={{ parameters, isLoading, refetch: fetchSystemParameters }}>
      {children}
    </SystemParametersContext.Provider>
  );
};

export const useSystemParameters = () => {
  const context = useContext(SystemParametersContext);
  if (context === undefined) {
    throw new Error('useSystemParameters must be used within SystemParametersProvider');
  }
  return context;
};
