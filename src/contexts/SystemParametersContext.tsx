import React, { createContext, useContext, useState, useEffect, useCallback } from 'react';
import { supabase } from '@/integrations/supabase/client';

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

// Connection state enum for clear distinction
export type ConnectionState = 'connecting' | 'connected' | 'disconnected' | 'error';

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
  connectionState: ConnectionState;
  refetch: () => Promise<void>;
}

const SystemParametersContext = createContext<SystemParametersContextType | undefined>(undefined);

export const SystemParametersProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [parameters, setParameters] = useState<SystemParameters | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [connectionState, setConnectionState] = useState<ConnectionState>('connecting');

  const fetchSystemParameters = useCallback(async () => {
    setConnectionState('connecting');

    try {
      console.log('📡 Fetching KIND 38888 from database...');

      // STEP 1: Try to read from database first
      const { data, error } = await supabase
        .from('kind_38888')
        .select('*')
        .order('created_at', { ascending: false })
        .limit(1)
        .single();

      if (error) {
        console.warn('⚠️ Database query error:', error);
        throw new Error(`Database error: ${error.message}`);
      }

      if (!data) {
        console.warn('⚠️ No KIND 38888 data in database, triggering sync...');
        // Trigger edge function to sync from relays
        await triggerSync();
        return;
      }

      // Verify the data is from authorized pubkey
      if (data.pubkey !== AUTHORIZED_PUBKEY) {
        throw new Error('Unauthorized pubkey in database');
      }

      console.log('✅ KIND 38888 loaded from database:', data.event_id);

      // Parse relays array
      const relays = Array.isArray(data.relays) 
        ? data.relays as string[]
        : [];

      // Parse electrum servers
      const electrumServers = Array.isArray(data.electrum_servers)
        ? (data.electrum_servers as any[]).map((s: any) => ({
            host: s.host || '',
            port: s.port || ''
          }))
        : [];

      // Parse exchange rates
      const exchangeRatesData = data.exchange_rates as Record<string, number> || {};
      const exchangeRates: ExchangeRates = {
        EUR: exchangeRatesData.EUR || 0,
        USD: exchangeRatesData.USD || 0,
        GBP: exchangeRatesData.GBP || 0
      };

      // Parse trusted signers
      const trustedSigners = (data.trusted_signers as TrustedSigners) || {};

      // Create relay statuses - mark all as connected since we got data from DB
      // Server-side sync validates relay connectivity
      const relayStatuses: RelayStatus[] = relays.map(url => ({
        url,
        connected: true,
        responseTime: undefined
      }));

      const systemParams: SystemParameters = {
        relays,
        relayStatuses,
        electrumServers,
        exchangeRates,
        split: data.split || '',
        version: data.version || '',
        validFrom: data.valid_from ? new Date(data.valid_from * 1000).toISOString() : '',
        connectedRelays: relays.length,
        isLoading: false,
        trustedSigners
      };

      setParameters(systemParams);
      setConnectionState('connected');

      // Cache in sessionStorage for immediate access on page refresh
      sessionStorage.setItem('lana_system_parameters', JSON.stringify(systemParams));

      console.log(`✅ System parameters loaded: ${relays.length} relays, version ${data.version}`);

    } catch (error) {
      console.error('❌ Error fetching system parameters:', error);
      
      // Try sessionStorage cache as fallback
      const cached = sessionStorage.getItem('lana_system_parameters');
      if (cached) {
        try {
          const cachedParams = JSON.parse(cached);
          console.log('📦 Using cached system parameters');
          setParameters(cachedParams);
          setConnectionState('connected');
          return;
        } catch (e) {
          console.warn('Failed to parse cached parameters');
        }
      }

      setParameters(null);
      setConnectionState('error');
      
      // Retry after 15 seconds
      console.log('🔄 Retrying in 15 seconds...');
      setTimeout(() => {
        fetchSystemParameters();
      }, 15000);
    } finally {
      setIsLoading(false);
    }
  }, []);

  const triggerSync = async () => {
    try {
      console.log('🔄 Triggering sync-kind-38888 edge function...');
      
      const { data, error } = await supabase.functions.invoke('sync-kind-38888');
      
      if (error) {
        console.error('❌ Sync edge function error:', error);
        throw error;
      }

      console.log('✅ Sync completed:', data);
      
      // Re-fetch after sync
      await fetchSystemParameters();
    } catch (error) {
      console.error('❌ Failed to trigger sync:', error);
      setConnectionState('error');
    }
  };

  useEffect(() => {
    fetchSystemParameters();
  }, [fetchSystemParameters]);

  // =============================================
  // SSE: Listen for heartbeat system parameter updates
  // When the server syncs new KIND 38888 data, re-fetch automatically
  // =============================================
  useEffect(() => {
    const API_URL = import.meta.env.VITE_API_URL || 'http://localhost:3001';
    const url = `${API_URL}/api/sse/system-params`;

    let eventSource: EventSource | null = null;
    let reconnectTimer: ReturnType<typeof setTimeout> | null = null;

    const connect = () => {
      try {
        eventSource = new EventSource(url);

        eventSource.onmessage = (event) => {
          try {
            const data = JSON.parse(event.data);
            if (data.type === 'system_params_updated') {
              console.log(`💓 Heartbeat: system parameters updated (version ${data.version}, ${data.relayCount} relays)`);
              // Re-fetch from database to get updated data
              fetchSystemParameters();
            }
          } catch {
            // Ignore parse errors
          }
        };

        eventSource.onerror = () => {
          console.warn('📡 System params SSE connection error, reconnecting in 30s...');
          eventSource?.close();
          eventSource = null;
          // Reconnect after 30 seconds
          reconnectTimer = setTimeout(connect, 30000);
        };

        console.log('📡 Connected to system params SSE heartbeat');
      } catch (err) {
        console.warn('📡 Failed to connect to system params SSE:', err);
        reconnectTimer = setTimeout(connect, 30000);
      }
    };

    connect();

    return () => {
      eventSource?.close();
      if (reconnectTimer) clearTimeout(reconnectTimer);
    };
  }, [fetchSystemParameters]);

  return (
    <SystemParametersContext.Provider value={{ parameters, isLoading, connectionState, refetch: fetchSystemParameters }}>
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
