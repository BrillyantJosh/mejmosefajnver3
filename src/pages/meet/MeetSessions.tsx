import { useState, useEffect, useCallback } from "react";
import { Card, CardContent } from "@/components/ui/card";
import { Clock, BarChart3, Coins, Activity, RefreshCw } from "lucide-react";
import { useAuth } from "@/contexts/AuthContext";
import { finalizeEvent } from "nostr-tools";
import { useTranslation } from "@/i18n/I18nContext";
import meetTranslations from "@/i18n/modules/meet";
import { Skeleton } from "@/components/ui/skeleton";
import { Button } from "@/components/ui/button";

const MEET_BASE_URL = "https://meet.lanaloves.us";

interface Session {
  session_id: string;
  display_name: string;
  room_id: string;
  speaking_language: string;
  started_at: number;
  ended_at: number | null;
  duration_seconds: number | null;
  stream_count: number;
  cost_eur: number;
  cost_lana: number;
  exchange_rate_eur: number | null;
  soniox_rate: number;
  markup: number;
}

interface SessionsData {
  pubkey: string;
  displayName: string;
  sessions: Session[];
  totalCostLana: number;
  totalCostEur: number;
  currentRate: number;
}

function createAuthToken(session: { nostrHexId: string; nostrPrivateKey: string; profileName?: string; profileDisplayName?: string; profileLang?: string }): string {
  const privateKeyBytes = new Uint8Array(
    session.nostrPrivateKey.match(/.{1,2}/g)!.map(byte => parseInt(byte, 16))
  );
  const content = JSON.stringify({
    name: session.profileDisplayName || session.profileName || 'Anon',
    lang: session.profileLang || 'sl',
  });
  const eventTemplate = {
    kind: 22242,
    created_at: Math.floor(Date.now() / 1000),
    tags: [['relay', 'meet.lanaloves.us'], ['action', 'join']],
    content,
    pubkey: session.nostrHexId,
  };
  const signedEvent = finalizeEvent(eventTemplate, privateKeyBytes);
  const json = JSON.stringify(signedEvent);
  return btoa(unescape(encodeURIComponent(json)))
    .replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function formatDuration(seconds: number | null): string {
  if (!seconds) return "—";
  const min = Math.floor(seconds / 60);
  const sec = seconds % 60;
  return `${min}:${String(sec).padStart(2, '0')}`;
}

function formatDate(ts: number): string {
  const d = new Date(ts * 1000);
  return d.toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' })
    + ' ' + d.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' });
}

export default function MeetSessions() {
  const { t } = useTranslation(meetTranslations);
  const { session } = useAuth();
  const [data, setData] = useState<SessionsData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const fetchSessions = useCallback(async () => {
    if (!session) return;
    setLoading(true);
    setError(null);
    try {
      const token = createAuthToken(session);
      const res = await fetch(`${MEET_BASE_URL}/api/sessions?authToken=${token}`);
      if (!res.ok) {
        const err = await res.json().catch(() => ({ error: 'Request failed' }));
        throw new Error(err.error || 'Request failed');
      }
      const result = await res.json();
      setData(result);
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : 'Unknown error');
    } finally {
      setLoading(false);
    }
  }, [session]);

  useEffect(() => {
    fetchSessions();
  }, [fetchSessions]);

  if (!session) {
    return (
      <div className="px-4">
        <Card>
          <CardContent className="pt-6 text-center text-muted-foreground">
            {t('sessions.loginRequired')}
          </CardContent>
        </Card>
      </div>
    );
  }

  if (loading) {
    return (
      <div className="px-4 space-y-4">
        <div className="grid grid-cols-2 gap-3">
          {[1,2,3,4].map(i => <Skeleton key={i} className="h-20 rounded-lg" />)}
        </div>
        <Skeleton className="h-40 rounded-lg" />
      </div>
    );
  }

  if (error) {
    return (
      <div className="px-4">
        <Card>
          <CardContent className="pt-6 text-center">
            <p className="text-destructive mb-3">{error}</p>
            <Button variant="outline" size="sm" onClick={fetchSessions}>
              <RefreshCw className="w-4 h-4 mr-2" /> {t('sessions.retry')}
            </Button>
          </CardContent>
        </Card>
      </div>
    );
  }

  return (
    <div className="px-4 space-y-4">
      {/* Header */}
      <div className="flex items-center justify-between">
        <h1 className="text-lg font-semibold flex items-center gap-2">
          <BarChart3 className="w-5 h-5 text-primary" />
          {t('sessions.title')}
        </h1>
        <Button variant="ghost" size="sm" onClick={fetchSessions}>
          <RefreshCw className="w-4 h-4" />
        </Button>
      </div>

      {/* Summary cards */}
      <div className="grid grid-cols-2 gap-3">
        <Card>
          <CardContent className="pt-4 pb-3 px-4">
            <div className="text-[11px] uppercase tracking-wide text-muted-foreground mb-1">{t('sessions.totalCost')}</div>
            <div className="text-xl font-bold text-yellow-500">{(data?.totalCostLana ?? 0).toFixed(2)} LANA</div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-4 pb-3 px-4">
            <div className="text-[11px] uppercase tracking-wide text-muted-foreground mb-1">{t('sessions.totalEur')}</div>
            <div className="text-xl font-bold text-primary">{(data?.totalCostEur ?? 0).toFixed(4)} &euro;</div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-4 pb-3 px-4">
            <div className="text-[11px] uppercase tracking-wide text-muted-foreground mb-1">{t('sessions.sessionCount')}</div>
            <div className="text-xl font-bold text-green-500">{data?.sessions.length ?? 0}</div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-4 pb-3 px-4">
            <div className="text-[11px] uppercase tracking-wide text-muted-foreground mb-1">{t('sessions.currentRate')}</div>
            <div className="text-lg font-bold text-muted-foreground">1 LANA = {data?.currentRate ?? '—'} &euro;</div>
          </CardContent>
        </Card>
      </div>

      {/* Sessions list */}
      {data?.sessions.length === 0 ? (
        <Card>
          <CardContent className="py-10 text-center text-muted-foreground">
            {t('sessions.noSessions')}
          </CardContent>
        </Card>
      ) : (
        <div className="space-y-2">
          {data?.sessions.map(s => (
            <Card key={s.session_id} className="overflow-hidden">
              <CardContent className="p-3">
                <div className="flex items-start justify-between mb-1">
                  <div>
                    <span className="text-sm font-medium">{s.room_id}</span>
                    {!s.ended_at && (
                      <span className="ml-2 inline-flex items-center gap-1 text-[10px] font-semibold bg-green-600 text-white px-1.5 py-0.5 rounded-full">
                        <Activity className="w-3 h-3" /> LIVE
                      </span>
                    )}
                  </div>
                  <span className="text-yellow-500 font-bold text-sm">
                    <Coins className="w-3.5 h-3.5 inline mr-1" />
                    {(s.cost_lana || 0).toFixed(2)} LANA
                  </span>
                </div>
                <div className="flex items-center gap-3 text-xs text-muted-foreground">
                  <span>{formatDate(s.started_at)}</span>
                  <span className="flex items-center gap-1">
                    <Clock className="w-3 h-3" />
                    {formatDuration(s.duration_seconds)}
                  </span>
                  <span>{s.stream_count} stream{s.stream_count !== 1 ? 's' : ''}</span>
                  <span>{s.speaking_language.toUpperCase()}</span>
                  <span className="ml-auto">{(s.cost_eur || 0).toFixed(4)} &euro;</span>
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}
