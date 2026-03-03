import { useParams, useNavigate } from "react-router-dom";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { UserAvatar } from "@/components/ui/UserAvatar";
import {
  Calendar, Clock, MapPin, Globe, Users,
  ExternalLink, Youtube, FileText, Wallet, Loader2, AlertCircle, LogIn, Share2, AlertTriangle
} from "lucide-react";
import { format } from "date-fns";
import { useNostrPublicEvent } from "@/hooks/useNostrPublicEvent";
import { useSystemParameters } from "@/contexts/SystemParametersContext";
import { getEventStatus } from "@/hooks/useNostrEvents";
import { toast } from "@/hooks/use-toast";
import { getTimezoneAbbreviation, getUserTimezone, formatTimeInTimezone } from "@/lib/timezones";
import { useTranslation } from '@/i18n/I18nContext';
import eventsTranslations from '@/i18n/modules/events';

export default function PublicEvent() {
  const { dTag } = useParams<{ dTag: string }>();
  const navigate = useNavigate();
  const { parameters } = useSystemParameters();
  const { t } = useTranslation(eventsTranslations);

  // Decode the URL-encoded dTag
  const decodedDTag = dTag ? decodeURIComponent(dTag) : '';
  
  const relays = parameters?.relays && parameters.relays.length > 0
    ? parameters.relays
    : undefined;

  const { event, profile, loading, error } = useNostrPublicEvent(decodedDTag, relays);

  const handleShare = async () => {
    // Use dTag for stable URL
    const shareUrl = `${window.location.origin}/event/${encodeURIComponent(event?.dTag || decodedDTag)}`;
    
    try {
      await navigator.clipboard.writeText(shareUrl);
      toast({
        title: t('card.linkCopied'),
        description: t('card.shareDescription')
      });
    } catch (err) {
      toast({
        title: t('card.copyFailed'),
        description: shareUrl,
        variant: "destructive"
      });
    }
  };

  const getDisplayName = () => {
    if (profile?.display_name) return profile.display_name;
    if (profile?.name) return profile.name;
    if (event?.organizerPubkey) return `${event.organizerPubkey.slice(0, 8)}...`;
    return 'Unknown';
  };

  if (loading) {
    return (
      <div className="min-h-screen bg-background flex items-center justify-center p-4">
        <div className="text-center space-y-4">
          <Loader2 className="h-8 w-8 animate-spin text-primary mx-auto" />
          <p className="text-sm text-muted-foreground">{t('public.loadingRelays')}</p>
        </div>
      </div>
    );
  }

  if (error || !event) {
    return (
      <div className="min-h-screen bg-background flex items-center justify-center p-4">
        <div className="max-w-2xl w-full space-y-4">
          <Alert variant="destructive">
            <AlertCircle className="h-4 w-4" />
            <AlertDescription>
              {error || t('detail.eventNotFound')}
            </AlertDescription>
          </Alert>
          <Button 
            onClick={() => window.location.reload()} 
            className="w-full"
          >
            {t('public.tryAgain')}
          </Button>
          <Button 
            variant="outline"
            onClick={() => navigate('/login')} 
            className="w-full"
          >
            <LogIn className="h-4 w-4 mr-2" />
            {t('public.loginLana')}
          </Button>
        </div>
      </div>
    );
  }

  const status = getEventStatus(event);

  return (
    <div className="min-h-screen bg-background p-4">
      <div className="max-w-2xl mx-auto space-y-4">
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-2xl font-bold">{t('public.title')}</h1>
            <p className="text-sm text-muted-foreground">{t('public.subtitle')}</p>
          </div>
          <Button variant="outline" size="icon" onClick={handleShare}>
            <Share2 className="h-4 w-4" />
          </Button>
        </div>

        {event.cover && (
          <div className="relative h-48 md:h-64 w-full overflow-hidden rounded-lg">
            <img 
              src={event.cover} 
              alt={event.title}
              className="h-full w-full object-cover"
            />
            {status !== 'upcoming' && (
              <Badge 
                className={`absolute top-4 right-4 text-lg px-4 py-2 ${
                  status === 'happening-now' 
                    ? 'bg-green-500 text-white animate-pulse' 
                    : 'bg-amber-500 text-white'
                }`}
              >
                {status === 'happening-now' ? t('status.happeningNow') : t('status.today')}
              </Badge>
            )}
          </div>
        )}

        <Card>
          <CardHeader>
            <div className="flex items-start justify-between gap-2">
              <CardTitle className="text-2xl">{event.title}</CardTitle>
              <div className="flex gap-2">
                <Badge variant="secondary">{event.eventType}</Badge>
                <Badge variant="outline">{event.language.toUpperCase()}</Badge>
              </div>
            </div>

            {!event.cover && status !== 'upcoming' && (
              <Badge
                className={`w-fit ${
                  status === 'happening-now'
                    ? 'bg-green-500 text-white animate-pulse'
                    : 'bg-amber-500 text-white'
                }`}
              >
                {status === 'happening-now' ? t('status.happeningNow') : t('status.today')}
              </Badge>
            )}
          </CardHeader>
          
          <CardContent className="space-y-6">
            {/* Organizer */}
            <div className="flex items-center gap-3 p-3 bg-muted/50 rounded-lg">
              <UserAvatar pubkey={event?.organizerPubkey} picture={profile?.picture} name={getDisplayName()} />
              <div>
                <p className="text-sm text-muted-foreground">{t('public.organizedBy')}</p>
                <p className="font-semibold">{getDisplayName()}</p>
              </div>
            </div>

            {/* Date and Time */}
            <div className="space-y-2">
              {event.schedule.length > 1 ? (
                /* Multi-day schedule */
                <div className="space-y-3">
                  <div className="flex items-center gap-2 text-lg">
                    <Calendar className="h-5 w-5 text-primary" />
                    <span className="font-medium">
                      {format(event.schedule[0].start, 'dd.MM')} – {format(event.schedule[event.schedule.length - 1].start, 'dd.MM.yyyy')}
                    </span>
                    <span className="text-sm text-muted-foreground">({t('card.days', { count: event.schedule.length })})</span>
                  </div>
                  <div className="bg-muted/30 rounded-lg p-3 space-y-2">
                    {event.schedule.map((entry, idx) => (
                      <div key={idx} className="flex items-center gap-3">
                        <span className="font-medium min-w-[90px]">{format(entry.start, 'EEE dd.MM')}</span>
                        <Clock className="h-4 w-4 text-primary shrink-0" />
                        <span>
                          {formatTimeInTimezone(entry.start, event.timezone || 'Europe/Ljubljana')}
                          {entry.end && ` – ${formatTimeInTimezone(entry.end, event.timezone || 'Europe/Ljubljana')}`}
                        </span>
                      </div>
                    ))}
                    <div className="text-sm text-muted-foreground pt-1">
                      {t('detail.timezone')} {getTimezoneAbbreviation(event.start, event.timezone || 'Europe/Ljubljana')}
                    </div>
                  </div>

                  {/* Show user's local time if different timezone */}
                  {(event.timezone || 'Europe/Ljubljana') !== getUserTimezone() && (
                    <div className="bg-muted/50 rounded-lg p-3 space-y-1">
                      <div className="text-sm text-muted-foreground mb-1">{t('detail.yourLocalTime', { tz: getTimezoneAbbreviation(event.start, getUserTimezone()) })}</div>
                      {event.schedule.map((entry, idx) => (
                        <div key={idx} className="flex items-center gap-3 text-sm text-muted-foreground">
                          <span className="min-w-[90px]">{format(entry.start, 'EEE dd.MM')}</span>
                          <Clock className="h-3 w-3 shrink-0" />
                          <span>
                            {formatTimeInTimezone(entry.start, getUserTimezone())}
                            {entry.end && ` – ${formatTimeInTimezone(entry.end, getUserTimezone())}`}
                          </span>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              ) : (
                /* Single-day event */
                <>
                  <div className="flex items-center gap-2 text-lg">
                    <Calendar className="h-5 w-5 text-primary" />
                    <span className="font-medium">{format(event.start, 'PPPP')}</span>
                  </div>
                  <div className="flex items-center gap-2 text-lg">
                    <Clock className="h-5 w-5 text-primary" />
                    <span>
                      {formatTimeInTimezone(event.start, event.timezone || 'Europe/Ljubljana')}
                      {event.end && ` - ${formatTimeInTimezone(event.end, event.timezone || 'Europe/Ljubljana')}`}
                      <span className="ml-2 text-muted-foreground">
                        ({getTimezoneAbbreviation(event.start, event.timezone || 'Europe/Ljubljana')})
                      </span>
                    </span>
                  </div>

                  {/* Show user's local time if different timezone */}
                  {(event.timezone || 'Europe/Ljubljana') !== getUserTimezone() && (
                    <div className="flex items-center gap-2 text-sm text-muted-foreground bg-muted/50 rounded-lg px-3 py-2">
                      <Clock className="h-4 w-4" />
                      <span>
                        {t('detail.yourLocalTimeSingle')} {formatTimeInTimezone(event.start, getUserTimezone())}
                        {event.end && ` - ${formatTimeInTimezone(event.end, getUserTimezone())}`}
                        {' '}({getTimezoneAbbreviation(event.start, getUserTimezone())})
                      </span>
                    </div>
                  )}
                </>
              )}

              {!event.timezone && (
                <div className="flex items-center gap-2 text-sm text-amber-500">
                  <AlertTriangle className="h-4 w-4" />
                  <span>{t('detail.legacyTimezone')}</span>
                </div>
              )}
            </div>

            {/* Location */}
            {event.isOnline ? (
              <div className="space-y-3">
                <div className="flex items-center gap-2">
                  <Globe className="h-5 w-5 text-blue-500" />
                  <span className="font-medium text-blue-500">{t('detail.onlineEvent')}</span>
                </div>
                {event.youtubeUrl && (() => {
                  const getYouTubeId = (url: string): string | null => {
                    const regExp = /^.*(youtu.be\/|v\/|u\/\w\/|embed\/|watch\?v=|&v=)([^#&?]*).*/;
                    const match = url.match(regExp);
                    return match && match[2].length === 11 ? match[2] : null;
                  };
                  const videoId = getYouTubeId(event.youtubeUrl);
                  return videoId ? (
                    <div className="aspect-video w-full rounded-lg overflow-hidden">
                      <iframe
                        src={`https://www.youtube.com/embed/${videoId}`}
                        title="YouTube video"
                        allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture"
                        allowFullScreen
                        className="w-full h-full"
                      />
                    </div>
                  ) : null;
                })()}
                {event.onlineUrl && (
                  <Button 
                    variant="outline" 
                    className="w-full"
                    onClick={() => window.open(event.onlineUrl, '_blank')}
                  >
                    <ExternalLink className="h-4 w-4 mr-2" />
                    {t('detail.joinEvent')}
                  </Button>
                )}
                {event.youtubeUrl && (
                  <Button 
                    variant="outline" 
                    className="w-full"
                    onClick={() => window.open(event.youtubeUrl, '_blank')}
                  >
                    <Youtube className="h-4 w-4 mr-2" />
                    {t('public.openYouTube')}
                  </Button>
                )}
              </div>
            ) : (
              <div className="space-y-2">
                {event.location && (
                  <div className="flex items-center gap-2">
                    <MapPin className="h-5 w-5 text-red-500" />
                    <span className="font-medium">{event.location}</span>
                  </div>
                )}
                {event.lat && event.lon && (
                  <Button 
                    variant="outline" 
                    className="w-full"
                    onClick={() => window.open(`https://www.google.com/maps?q=${event.lat},${event.lon}`, '_blank')}
                  >
                    <MapPin className="h-4 w-4 mr-2" />
                    {t('detail.openInMaps')}
                  </Button>
                )}
                {event.capacity && (
                  <div className="flex items-center gap-2">
                    <Users className="h-5 w-5" />
                    <span>{t('detail.capacity', { count: String(event.capacity) })}</span>
                  </div>
                )}
              </div>
            )}

            {/* Value and Donation */}
            {(event.fiatValue || event.donationWallet) && (
              <div className="border-t pt-4 space-y-3">
                {event.fiatValue && (
                  <div className="text-lg font-medium text-primary">
                    {t('detail.eventValue', { amount: String(event.fiatValue) })}
                  </div>
                )}
                {event.donationWallet && (
                  <>
                    <div className="flex items-center gap-2 text-sm text-muted-foreground">
                      <Wallet className="h-4 w-4" />
                      <span className="font-mono truncate">{event.donationWallet}</span>
                    </div>
                    <Button 
                      className="w-full"
                      onClick={() => navigate('/login')}
                    >
                      <Wallet className="h-4 w-4 mr-2" />
                      {event.fiatValue ? t('card.pay', { amount: String(event.fiatValue) }) : t('card.donate')} {t('public.loginRequired')}
                    </Button>
                  </>
                )}
              </div>
            )}

            {/* Description */}
            {event.content && (
              <div className="border-t pt-4">
                <h3 className="font-semibold mb-2">{t('detail.description')}</h3>
                <div className="prose prose-sm dark:prose-invert max-w-none whitespace-pre-wrap">
                  {event.content}
                </div>
              </div>
            )}

            {/* Attachments */}
            {event.attachments && event.attachments.length > 0 && (
              <div className="border-t pt-4">
                <h3 className="font-semibold mb-2">{t('detail.attachments')}</h3>
                <div className="space-y-2">
                  {event.attachments.map((url, index) => (
                    <Button 
                      key={index}
                      variant="outline" 
                      className="w-full justify-start"
                      onClick={() => window.open(url, '_blank')}
                    >
                      <FileText className="h-4 w-4 mr-2" />
                      {url.split('/').pop() || t('detail.attachment', { index: String(index + 1) })}
                    </Button>
                  ))}
                </div>
              </div>
            )}

            {/* YouTube Recording */}
            {event.youtubeRecordingUrl && (() => {
              const getYouTubeId = (url: string): string | null => {
                const regExp = /^.*(youtu.be\/|v\/|u\/\w\/|embed\/|watch\?v=|&v=)([^#&?]*).*/;
                const match = url.match(regExp);
                return match && match[2].length === 11 ? match[2] : null;
              };
              const videoId = getYouTubeId(event.youtubeRecordingUrl);
              return (
                <div className="border-t pt-4">
                  <h3 className="font-semibold mb-2">{t('detail.eventRecording')}</h3>
                  {videoId ? (
                    <div className="aspect-video w-full rounded-lg overflow-hidden">
                      <iframe
                        src={`https://www.youtube.com/embed/${videoId}`}
                        title="Event Recording"
                        allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture"
                        allowFullScreen
                        className="w-full h-full"
                      />
                    </div>
                  ) : (
                    <Button 
                      variant="outline" 
                      className="w-full"
                      onClick={() => window.open(event.youtubeRecordingUrl, '_blank')}
                    >
                      <Youtube className="h-4 w-4 mr-2" />
                      {t('detail.watchRecording')}
                    </Button>
                  )}
                </div>
              );
            })()}

            {/* Recording (legacy field) */}
            {event.recording && !event.youtubeRecordingUrl && (
              <div className="border-t pt-4">
                <h3 className="font-semibold mb-2">{t('detail.recording')}</h3>
                <Button 
                  variant="outline" 
                  className="w-full"
                  onClick={() => window.open(event.recording, '_blank')}
                >
                  <ExternalLink className="h-4 w-4 mr-2" />
                  {t('detail.watchRecording')}
                </Button>
              </div>
            )}

            {/* CTA for non-logged in users */}
            <div className="border-t pt-6">
              <div className="bg-primary/10 border border-primary/20 rounded-lg p-4 text-center space-y-3">
                <p className="font-medium">{t('public.wantToRegister')}</p>
                <p className="text-sm text-muted-foreground">{t('public.loginToRegister')}</p>
                <Button 
                  className="w-full"
                  onClick={() => navigate('/login')}
                >
                  <LogIn className="h-4 w-4 mr-2" />
                  {t('public.loginButton')}
                </Button>
              </div>
            </div>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
