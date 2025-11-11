import { useSystemParameters } from '@/contexts/SystemParametersContext';
import { Wifi, WifiOff } from 'lucide-react';
import { Card } from './ui/card';

export const NostrStatus = () => {
  const { parameters, isLoading } = useSystemParameters();

  if (isLoading) {
    return (
      <Card className="p-4 mb-6 bg-card/50 backdrop-blur">
        <div className="flex items-center gap-2 text-sm text-muted-foreground">
          <div className="animate-spin rounded-full h-4 w-4 border-b-2 border-primary"></div>
          <span>Connecting to Nostr Network...</span>
        </div>
      </Card>
    );
  }

  if (!parameters) {
    return (
      <Card className="p-4 mb-6 bg-destructive/10 backdrop-blur border-destructive">
        <div className="flex items-center gap-2">
          <WifiOff className="h-5 w-5 text-destructive" />
          <div>
            <div className="font-semibold text-destructive">Failed to Connect to Nostr Network</div>
            <p className="text-sm text-muted-foreground mt-1">
              Cannot connect to relays. Retrying automatically...
            </p>
          </div>
        </div>
      </Card>
    );
  }

  const isConnected = parameters.connectedRelays > 0;

  return (
    <Card className="p-4 mb-6 bg-card/50 backdrop-blur">
      <div className="space-y-3">
        <div className="flex items-start gap-3">
          {isConnected ? (
            <Wifi className="h-5 w-5 text-green-500 mt-0.5" />
          ) : (
            <WifiOff className="h-5 w-5 text-red-500 mt-0.5" />
          )}
          <div className="flex-1">
            <div className="font-semibold text-foreground mb-2">
              {isConnected ? 'Connected to Nostr Network' : 'Connecting to Nostr Network'}
            </div>
            
            <div className="text-sm space-y-2">
              <div>
                <span className="text-muted-foreground">relays: </span>
                <span className="font-medium text-foreground">
                  {parameters.connectedRelays}/{parameters.relays.length} connected
                </span>
              </div>
              
              <div className="space-y-1">
                {parameters.relayStatuses?.map((relayStatus, index) => (
                  <div key={index} className="flex items-center justify-between gap-2 text-xs">
                    <div className="flex items-center gap-2 min-w-0 flex-1">
                      <div className={`w-2 h-2 rounded-full flex-shrink-0 ${
                        relayStatus.connected ? 'bg-green-500' : 'bg-red-500'
                      }`} />
                      <span className="text-muted-foreground truncate break-all">{relayStatus.url}</span>
                    </div>
                    {relayStatus.connected && relayStatus.responseTime && (
                      <span className="text-green-600 font-medium flex-shrink-0 whitespace-nowrap">
                        {relayStatus.responseTime}ms
                      </span>
                    )}
                  </div>
                ))}
              </div>
            </div>
          </div>
        </div>

        <div className="pt-3 border-t border-border">
          <div className="grid grid-cols-2 gap-4 text-sm">
            <div>
              <div className="font-medium text-foreground mb-2">Exchange Rates:</div>
              <div className="space-y-1 text-xs text-muted-foreground">
                <div>EUR: {parameters.exchangeRates.EUR.toFixed(4)} per LANA</div>
                <div>USD: {parameters.exchangeRates.USD.toFixed(4)} per LANA</div>
                <div>GBP: {parameters.exchangeRates.GBP.toFixed(4)} per LANA</div>
              </div>
            </div>

            <div>
              <div className="font-medium text-foreground mb-2">System Info:</div>
              <div className="space-y-1 text-xs text-muted-foreground">
                <div>
                  <span className="font-medium">Split:</span> {parameters.split}
                </div>
                <div>
                  <span className="font-medium">Version:</span> {parameters.version}
                </div>
                {parameters.validFrom && (
                  <div>
                    <span className="font-medium">Valid from:</span>{' '}
                    {new Date(parseInt(parameters.validFrom) * 1000).toLocaleDateString()}
                  </div>
                )}
              </div>
            </div>
          </div>
        </div>

        {parameters.trustedSigners && Object.keys(parameters.trustedSigners).length > 0 && (
          <div className="pt-3 border-t border-border">
            <div className="font-medium text-foreground mb-2">🔑 Trusted Signers</div>
            <div className="space-y-2 text-xs">
              {Object.entries(parameters.trustedSigners).map(([functionName, pubkeys]) => (
                <div key={functionName} className="space-y-1">
                  <div className="font-medium text-foreground">{functionName}:</div>
                  {pubkeys.length > 0 ? (
                    <div className="space-y-0.5 pl-2">
                      {pubkeys.map((pubkey, idx) => (
                        <div key={idx} className="text-muted-foreground font-mono break-all">
                          {pubkey}
                        </div>
                      ))}
                    </div>
                  ) : (
                    <div className="text-muted-foreground pl-2 italic">No signers configured</div>
                  )}
                </div>
              ))}
            </div>
          </div>
        )}
      </div>
    </Card>
  );
};
