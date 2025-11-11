import { useState, useEffect } from "react";
import { useSystemParameters } from "@/contexts/SystemParametersContext";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Radio, CheckCircle2, XCircle, Loader2 } from "lucide-react";

type RelayStatus = 'checking' | 'connected' | 'error';

export default function RelaysList() {
  const { parameters } = useSystemParameters();
  const relays = parameters?.relays || [];
  const [relayStatuses, setRelayStatuses] = useState<Map<string, RelayStatus>>(new Map());

  useEffect(() => {
    const checkRelayConnectivity = async () => {
      const statusMap = new Map<string, RelayStatus>();
      
      // Initialize all as checking
      relays.forEach(relay => statusMap.set(relay, 'checking'));
      setRelayStatuses(new Map(statusMap));

      // Test each relay
      const testPromises = relays.map(async (relay) => {
        try {
          const ws = new WebSocket(relay);
          
          return new Promise<void>((resolve) => {
            const timeout = setTimeout(() => {
              ws.close();
              statusMap.set(relay, 'error');
              resolve();
            }, 5000);

            ws.onopen = () => {
              clearTimeout(timeout);
              statusMap.set(relay, 'connected');
              ws.close();
              resolve();
            };

            ws.onerror = () => {
              clearTimeout(timeout);
              statusMap.set(relay, 'error');
              resolve();
            };
          });
        } catch (error) {
          statusMap.set(relay, 'error');
        }
      });

      await Promise.all(testPromises);
      setRelayStatuses(new Map(statusMap));
    };

    if (relays.length > 0) {
      checkRelayConnectivity();
    }
  }, [relays]);

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Radio className="h-5 w-5" />
            Default Relays
          </CardTitle>
          <CardDescription>
            List of all default Nostr relays used by this application
          </CardDescription>
        </CardHeader>
        <CardContent>
          {relays.length === 0 ? (
            <p className="text-muted-foreground text-center py-8">No relays configured</p>
          ) : (
            <div className="space-y-3">
              {relays.map((relay, index) => {
                const status = relayStatuses.get(relay) || 'checking';
                
                return (
                  <div 
                    key={index}
                    className="flex items-center justify-between p-4 rounded-lg border bg-card hover:bg-secondary/50 transition-colors"
                  >
                    <div className="flex items-center gap-3">
                      <div className={`h-2 w-2 rounded-full ${
                        status === 'connected' ? 'bg-green-500' :
                        status === 'error' ? 'bg-red-500' :
                        'bg-yellow-500 animate-pulse'
                      }`} />
                      <span className="font-mono text-sm">{relay}</span>
                    </div>
                    {status === 'checking' && (
                      <Badge variant="secondary" className="gap-1">
                        <Loader2 className="h-3 w-3 animate-spin" />
                        Checking
                      </Badge>
                    )}
                    {status === 'connected' && (
                      <Badge variant="secondary" className="gap-1 bg-green-500/10 text-green-700 dark:text-green-400">
                        <CheckCircle2 className="h-3 w-3" />
                        Connected
                      </Badge>
                    )}
                    {status === 'error' && (
                      <Badge variant="secondary" className="gap-1 bg-red-500/10 text-red-700 dark:text-red-400">
                        <XCircle className="h-3 w-3" />
                        Error
                      </Badge>
                    )}
                  </div>
                );
              })}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
