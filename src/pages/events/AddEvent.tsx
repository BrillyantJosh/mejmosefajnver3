import { useState, useEffect } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { Loader2, Plus, X, Calendar, MapPin, Globe, Link2, ImagePlus, Wallet, Map, Video, Check, Copy, Trash2 } from "lucide-react";
import { useAuth } from "@/contexts/AuthContext";
import LocationPicker from "@/components/LocationPicker";
import { AddressSearch } from "@/components/AddressSearch";
import { useSystemParameters } from "@/contexts/SystemParametersContext";
import { SimplePool, finalizeEvent } from "nostr-tools";
import { toast } from "@/hooks/use-toast";
import { supabase } from "@/integrations/supabase/client";
import { useNostrWallets } from "@/hooks/useNostrWallets";
import { useNostrUnregisteredWallets } from "@/hooks/useNostrUnregisteredWallets";
import { useNostrProfileCache } from "@/hooks/useNostrProfileCache";
import { COMMON_TIMEZONES, DEFAULT_TIMEZONE, getTimezoneOffset } from "@/lib/timezones";
import { useTranslation } from '@/i18n/I18nContext';
import eventsTranslations from '@/i18n/modules/events';

const EVENT_TYPES = [
  { value: 'governance', label: 'Governance' },
  { value: 'awareness', label: 'Awareness' },
  { value: 'workshop', label: 'Workshop' },
  { value: 'celebration', label: 'Celebration' },
  { value: 'meetup', label: 'Meetup' },
  { value: 'conference', label: 'Conference' },
  { value: 'other', label: 'Other' }
];

const LANGUAGES = [
  { value: 'sl', label: 'Slovenščina' },
  { value: 'en', label: 'English' },
  { value: 'de', label: 'Deutsch' },
  { value: 'hr', label: 'Hrvatski' },
  { value: 'sr', label: 'Srpski' }
];

const LANA_MEET_BASE_URL = "https://meet.lanaloves.us";

// Build NIP-22242 auth token (same shape as MeetSchedule.tsx)
function createMeetAuthToken(session: { nostrHexId: string; nostrPrivateKey: string; profileName?: string; profileDisplayName?: string; profileLang?: string }): string {
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

function meetSlug(title: string): string {
  return title.trim().toLowerCase()
    .replace(/[čć]/g, 'c').replace(/[šś]/g, 's').replace(/[žź]/g, 'z')
    .replace(/đ/g, 'd')
    .replace(/\s+/g, '-').replace(/[^a-z0-9-]/g, '')
    .slice(0, 40) || 'event';
}

interface AddEventPrefill {
  title?: string;
  content?: string;
  eventType?: string;
  language?: string;
  timezone?: string;
  isOnline?: boolean;
  onlineUrl?: string;
  lanaMeetUrl?: string;
  youtubeUrl?: string;
  youtubeRecordingUrls?: string[];
  location?: string;
  lat?: string;
  lon?: string;
  capacity?: string;
  coverUrl?: string;
  donationWallet?: string;
  donationWalletUnreg?: string;
  fiatValue?: string;
  attachments?: string[];
  schedule?: Array<{ date: string; startTime: string; endTime: string }>;
}

export default function AddEvent() {
  const routerLocation = useLocation();
  const navigate = useNavigate();
  // `prefill` is populated when this page is opened from "Copy event" on /events/my.
  const prefill = (routerLocation.state as { prefill?: AddEventPrefill } | null)?.prefill;

  const { session } = useAuth();
  const { parameters: systemParameters } = useSystemParameters();
  const { t } = useTranslation(eventsTranslations);
  const { wallets, isLoading: walletsLoading } = useNostrWallets();
  const { lists: unregLists, isLoading: unregLoading } = useNostrUnregisteredWallets();
  const { profile: userProfile } = useNostrProfileCache(session?.nostrHexId || null);

  // User's profile location as fallback for map picker
  const profileLat = userProfile?.raw_metadata?.latitude as number | undefined;
  const profileLng = userProfile?.raw_metadata?.longitude as number | undefined;

  // Filter out excluded wallet types
  const EXCLUDED_WALLET_TYPES = ['LanaPays.Us', 'Knights', 'Lana8Wonder'];
  const availableWallets = wallets.filter(
    w => w.status === 'active' && !EXCLUDED_WALLET_TYPES.includes(w.walletType)
  );

  // Get user's unregistered wallets
  const myUnregWallets = unregLists
    .filter(l => l.ownerPubkey === session?.nostrHexId)
    .flatMap(l => l.wallets);
  
  const [isOnline, setIsOnline] = useState(prefill?.isOnline ?? true);
  const [publishing, setPublishing] = useState(false);
  const [uploading, setUploading] = useState(false);

  // Form state — initial values fall back to prefill (when cloning an event)
  const [title, setTitle] = useState(prefill?.title ?? "");
  const [content, setContent] = useState(prefill?.content ?? "");
  const [eventType, setEventType] = useState(prefill?.eventType ?? "awareness");
  const [language, setLanguage] = useState(prefill?.language ?? "sl");
  const [timezone, setTimezone] = useState(prefill?.timezone ?? DEFAULT_TIMEZONE);
  // Schedule: array of {date, startTime, endTime} for multi-day support
  const [schedule, setSchedule] = useState<Array<{date: string; startTime: string; endTime: string}>>(
    prefill?.schedule && prefill.schedule.length > 0
      ? prefill.schedule
      : [{ date: '', startTime: '', endTime: '' }],
  );

  // Online fields
  const [onlineUrl, setOnlineUrl] = useState(prefill?.onlineUrl ?? "");
  const [creatingLanaMeet, setCreatingLanaMeet] = useState(false);
  const [lanaMeetCreated, setLanaMeetCreated] = useState(false);
  // Optional Lana Meet URL for physical events (so people can also join online)
  const [lanaMeetUrl, setLanaMeetUrl] = useState(prefill?.lanaMeetUrl ?? "");
  const [creatingPhysicalLanaMeet, setCreatingPhysicalLanaMeet] = useState(false);
  const [physicalLanaMeetCreated, setPhysicalLanaMeetCreated] = useState(false);
  const [youtubeUrl, setYoutubeUrl] = useState(prefill?.youtubeUrl ?? "");
  const [youtubeRecordingUrls, setYoutubeRecordingUrls] = useState<string[]>(
    prefill?.youtubeRecordingUrls && prefill.youtubeRecordingUrls.length > 0
      ? prefill.youtubeRecordingUrls
      : [""],
  );

  // Physical fields
  const [location, setLocation] = useState(prefill?.location ?? "");
  const [lat, setLat] = useState(prefill?.lat ?? "");
  const [lon, setLon] = useState(prefill?.lon ?? "");
  const [capacity, setCapacity] = useState(prefill?.capacity ?? "");
  const [showMapPicker, setShowMapPicker] = useState(false);

  // Optional fields
  const [coverUrl, setCoverUrl] = useState(prefill?.coverUrl ?? "");
  const [coverFile, setCoverFile] = useState<File | null>(null);
  const [coverPreview, setCoverPreview] = useState(prefill?.coverUrl ?? "");
  const [donationWallet, setDonationWallet] = useState(prefill?.donationWallet ?? "");
  const [donationWalletUnreg, setDonationWalletUnreg] = useState(prefill?.donationWalletUnreg ?? "");
  const [fiatValue, setFiatValue] = useState(prefill?.fiatValue ?? "");
  const [attachments, setAttachments] = useState<string[]>(
    prefill?.attachments && prefill.attachments.length > 0 ? prefill.attachments : [""],
  );
  
  const relays = systemParameters?.relays || [];

  // After consuming prefill on first render, clear router state so the user
  // can refresh / navigate back without re-applying the clone.
  useEffect(() => {
    if (prefill) {
      navigate(routerLocation.pathname, { replace: true, state: null });
      toast({
        title: t('my.copyToastTitle'),
        description: t('my.copyToastDesc'),
      });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const handleCoverSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) {
      setCoverFile(file);
      setCoverPreview(URL.createObjectURL(file));
      setCoverUrl("");
    }
  };

  const removeCover = () => {
    if (coverPreview) {
      URL.revokeObjectURL(coverPreview);
    }
    setCoverFile(null);
    setCoverPreview("");
  };

  const resizeImage = async (file: File, maxWidth: number = 1200): Promise<Blob> => {
    return new Promise((resolve, reject) => {
      const img = new Image();
      img.onload = () => {
        const canvas = document.createElement('canvas');
        let width = img.width;
        let height = img.height;

        if (width > maxWidth) {
          height = (height * maxWidth) / width;
          width = maxWidth;
        }

        canvas.width = width;
        canvas.height = height;

        const ctx = canvas.getContext('2d');
        if (!ctx) {
          reject(new Error('Could not get canvas context'));
          return;
        }

        ctx.drawImage(img, 0, 0, width, height);
        canvas.toBlob(
          (blob) => {
            if (blob) {
              resolve(blob);
            } else {
              reject(new Error('Failed to create blob'));
            }
          },
          'image/jpeg',
          0.85
        );
      };
      img.onerror = reject;
      img.src = URL.createObjectURL(file);
    });
  };

  const uploadCoverImage = async (): Promise<string | null> => {
    if (!coverFile || !session?.nostrHexId) return null;

    setUploading(true);
    try {
      const resizedBlob = await resizeImage(coverFile);
      const fileName = `events/${session.nostrHexId}/${Date.now()}-${Math.random().toString(36).substring(7)}.jpg`;

      const { data, error } = await supabase.storage
        .from('post-images')
        .upload(fileName, resizedBlob, {
          contentType: 'image/jpeg',
          cacheControl: '3600',
          upsert: false
        });

      if (error) throw error;

      const { data: { publicUrl } } = supabase.storage
        .from('post-images')
        .getPublicUrl(data.path);

      return publicUrl;
    } catch (error) {
      console.error('Error uploading cover:', error);
      toast({
        title: t('toast.errorUploadingCover'),
        description: error instanceof Error ? error.message : t('reg.unknownError'),
        variant: "destructive"
      });
      return null;
    } finally {
      setUploading(false);
    }
  };

  const addAttachment = () => {
    setAttachments([...attachments, ""]);
  };

  const removeAttachment = (index: number) => {
    setAttachments(attachments.filter((_, i) => i !== index));
  };

  const updateAttachment = (index: number, value: string) => {
    const newAttachments = [...attachments];
    newAttachments[index] = value;
    setAttachments(newAttachments);
  };

  const handleCreateLanaMeet = async () => {
    if (!session?.nostrPrivateKey || !session?.nostrHexId) {
      toast({ title: t('reg.error'), description: t('toast.loginToCreate'), variant: "destructive" });
      return;
    }
    if (!title.trim()) {
      toast({ title: t('reg.error'), description: t('toast.titleRequired'), variant: "destructive" });
      return;
    }
    const firstEntry = schedule.find(s => s.date && s.startTime);
    if (!firstEntry) {
      toast({ title: t('reg.error'), description: t('toast.dateRequired'), variant: "destructive" });
      return;
    }

    setCreatingLanaMeet(true);
    try {
      const tzOffset = getTimezoneOffset(timezone, new Date(`${firstEntry.date}T${firstEntry.startTime}`));
      const scheduledAt = new Date(`${firstEntry.date}T${firstEntry.startTime}:00${tzOffset}`).toISOString();
      const roomId = meetSlug(title) + '-' + Math.floor(Math.random() * 100);
      const token = createMeetAuthToken(session);

      const res = await fetch(`${LANA_MEET_BASE_URL}/api/meetings`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          title: title.trim(),
          roomId,
          scheduledAt,
          authToken: token,
          visibility: 'public',
          invitees: [],
        }),
      });

      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err.error || 'Failed to create Lana Meet');
      }

      const meeting = await res.json();
      const link = `${LANA_MEET_BASE_URL}/${meeting.roomId}`;
      setOnlineUrl(link);
      setLanaMeetCreated(true);
      try { await navigator.clipboard.writeText(link); } catch { /* clipboard unavailable */ }
      toast({ title: 'Lana Meet ustvarjen', description: 'Povezava je shranjena in skopirana' });
    } catch (err: any) {
      toast({ title: t('reg.error'), description: err?.message || 'Napaka pri ustvarjanju Lana Meet', variant: 'destructive' });
    } finally {
      setCreatingLanaMeet(false);
    }
  };

  // Optional Lana Meet creation for physical events — lets attendees also join online
  const handleCreatePhysicalLanaMeet = async () => {
    if (!session?.nostrPrivateKey || !session?.nostrHexId) {
      toast({ title: t('reg.error'), description: t('toast.loginToCreate'), variant: "destructive" });
      return;
    }
    if (!title.trim()) {
      toast({ title: t('reg.error'), description: t('toast.titleRequired'), variant: "destructive" });
      return;
    }
    const firstEntry = schedule.find(s => s.date && s.startTime);
    if (!firstEntry) {
      toast({ title: t('reg.error'), description: t('toast.dateRequired'), variant: "destructive" });
      return;
    }

    setCreatingPhysicalLanaMeet(true);
    try {
      const tzOffset = getTimezoneOffset(timezone, new Date(`${firstEntry.date}T${firstEntry.startTime}`));
      const scheduledAt = new Date(`${firstEntry.date}T${firstEntry.startTime}:00${tzOffset}`).toISOString();
      const roomId = meetSlug(title) + '-' + Math.floor(Math.random() * 100);
      const token = createMeetAuthToken(session);

      const res = await fetch(`${LANA_MEET_BASE_URL}/api/meetings`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          title: title.trim(),
          roomId,
          scheduledAt,
          authToken: token,
          visibility: 'public',
          invitees: [],
        }),
      });

      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err.error || 'Failed to create Lana Meet');
      }

      const meeting = await res.json();
      const link = `${LANA_MEET_BASE_URL}/${meeting.roomId}`;
      setLanaMeetUrl(link);
      setPhysicalLanaMeetCreated(true);
      try { await navigator.clipboard.writeText(link); } catch { /* clipboard unavailable */ }
      toast({ title: 'Lana Meet ustvarjen', description: 'Povezava je shranjena in skopirana' });
    } catch (err: any) {
      toast({ title: t('reg.error'), description: err?.message || 'Napaka pri ustvarjanju Lana Meet', variant: 'destructive' });
    } finally {
      setCreatingPhysicalLanaMeet(false);
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();

    if (!session?.nostrPrivateKey || !session?.nostrHexId) {
      toast({
        title: t('reg.error'),
        description: t('toast.loginToCreate'),
        variant: "destructive"
      });
      return;
    }

    // Validation
    if (!title.trim()) {
      toast({ title: t('reg.error'), description: t('toast.titleRequired'), variant: "destructive" });
      return;
    }
    // Validate schedule entries
    const validSchedule = schedule.filter(s => s.date && s.startTime);
    if (validSchedule.length === 0) {
      toast({ title: t('reg.error'), description: t('toast.dateRequired'), variant: "destructive" });
      return;
    }
    if (isOnline && !onlineUrl.trim()) {
      toast({ title: t('reg.error'), description: t('toast.onlineUrlRequired'), variant: "destructive" });
      return;
    }
    if (!isOnline && (!lat.trim() || !lon.trim())) {
      toast({ title: t('reg.error'), description: t('toast.coordsRequired'), variant: "destructive" });
      return;
    }
    if (!coverFile && !coverUrl.trim()) {
      toast({ title: t('reg.error'), description: 'Cover fotografija je obvezna.', variant: "destructive" });
      return;
    }

    try {
      setPublishing(true);

      // Upload cover if file selected
      let finalCoverUrl = coverUrl;
      if (coverFile) {
        const uploadedUrl = await uploadCoverImage();
        if (uploadedUrl) {
          finalCoverUrl = uploadedUrl;
        }
      }

      const pool = new SimplePool();
      const privKeyBytes = new Uint8Array(session.nostrPrivateKey.match(/.{1,2}/g)!.map(byte => parseInt(byte, 16)));

      // Generate unique event ID
      const eventSlug = `event:${Date.now()}-${Math.random().toString(36).substring(7)}`;

      // Sort valid schedule entries by date
      const sortedSchedule = [...validSchedule].sort((a, b) => `${a.date}T${a.startTime}`.localeCompare(`${b.date}T${b.startTime}`));

      // Derive overall start/end from first/last schedule entries
      const firstEntry = sortedSchedule[0];
      const lastEntry = sortedSchedule[sortedSchedule.length - 1];
      const tzOffset = getTimezoneOffset(timezone, new Date(`${firstEntry.date}T${firstEntry.startTime}`));
      const startDateTime = `${firstEntry.date}T${firstEntry.startTime}:00${tzOffset}`;
      const endDateTime = lastEntry.endTime
        ? `${lastEntry.date}T${lastEntry.endTime}:00${tzOffset}`
        : null;

      // Build tags
      const tags: string[][] = [
        ["d", eventSlug],
        ["title", title.trim()],
        ["status", "active"],
        ["start", startDateTime],
        ["language", language],
        ["event_type", eventType],
        ["p", session.nostrHexId],
        ["timezone", timezone]
      ];

      // Add end time if provided
      if (endDateTime) {
        tags.push(["end", endDateTime]);
      }

      // Add schedule tags for multi-day events (or single day with explicit schedule)
      if (sortedSchedule.length > 1) {
        for (const entry of sortedSchedule) {
          const entryTzOffset = getTimezoneOffset(timezone, new Date(`${entry.date}T${entry.startTime}`));
          const scheduleTag: string[] = ["schedule", `${entry.date}T${entry.startTime}:00${entryTzOffset}`];
          if (entry.endTime) {
            scheduleTag.push(`${entry.date}T${entry.endTime}:00${entryTzOffset}`);
          }
          tags.push(scheduleTag);
        }
      }

      // Add location-specific tags
      if (isOnline) {
        tags.push(["online", onlineUrl.trim()]);
      } else {
        tags.push(["lat", lat.trim()]);
        tags.push(["lon", lon.trim()]);
        if (location.trim()) {
          tags.push(["location", location.trim()]);
        }
        if (capacity.trim()) {
          tags.push(["capacity", capacity.trim()]);
        }
        // Optional Lana Meet URL for physical events — lets people also join online
        if (lanaMeetUrl.trim()) {
          tags.push(["lana_meet", lanaMeetUrl.trim()]);
        }
      }

      // YouTube tags (both online and physical events)
      if (youtubeUrl.trim()) {
        tags.push(["youtube", youtubeUrl.trim()]);
      }
      // Multiple recording URLs — one tag per URL
      for (const raw of youtubeRecordingUrls) {
        let recordingUrl = (raw || '').trim();
        if (!recordingUrl) continue;
        if (!recordingUrl.startsWith('http://') && !recordingUrl.startsWith('https://')) {
          recordingUrl = 'https://' + recordingUrl;
        }
        tags.push(["youtube_recording", recordingUrl]);
      }

      // Optional tags
      if (finalCoverUrl.trim()) {
        tags.push(["cover", finalCoverUrl.trim()]);
      }
      if (donationWallet.trim()) {
        tags.push(["donation_wallet", donationWallet.trim()]);
      }
      if (donationWalletUnreg.trim()) {
        tags.push(["donation_wallet_unreg", donationWalletUnreg.trim()]);
      }
      if (fiatValue.trim()) {
        tags.push(["fiat_value", fiatValue.trim()]);
      }

      // Attachments
      attachments.forEach(url => {
        if (url.trim()) {
          tags.push(["attachment", url.trim()]);
        }
      });

      const event = finalizeEvent({
        kind: 36677,
        created_at: Math.floor(Date.now() / 1000),
        tags,
        content: content.trim(),
      }, privKeyBytes);

      console.log('📤 Publishing event to relays:', relays);
      console.log('📤 Event:', event);

      // ─── Step 1: try direct browser → relay WebSocket publish ────────────
      const publishArray = Array.from(pool.publish(relays, event));
      const perRelay: Array<{ relay: string; ok: boolean; error?: string }> = relays.map((r) => ({
        relay: r,
        ok: false,
      }));

      // Wait up to 10s for ALL relays to respond (settle), so we know exactly
      // which ones failed and why — no early-exit on first success.
      await Promise.allSettled(
        publishArray.map((p, idx) =>
          Promise.race([
            p.then(
              () => { perRelay[idx].ok = true; },
              (err) => { perRelay[idx].error = err?.message || String(err) || 'rejected'; },
            ),
            new Promise<void>((resolve) => setTimeout(() => {
              if (!perRelay[idx].ok && !perRelay[idx].error) {
                perRelay[idx].error = 'timeout';
              }
              resolve();
            }, 10000)),
          ]),
        ),
      );

      let successCount = perRelay.filter((r) => r.ok).length;
      const failedRelays = perRelay.filter((r) => !r.ok);

      console.log('📤 Direct publish results:', perRelay);
      if (failedRelays.length > 0) {
        console.warn('⚠️ Failed relays:', failedRelays);
      }

      // ─── Step 2: if 0 succeeded, fall back to server-side publish ───────
      if (successCount === 0) {
        console.log('🔁 Direct publish failed for all relays — trying server fallback');
        try {
          const { data, error } = await supabase.functions.invoke('publish-dm-event', {
            body: { event },
          });
          if (error) throw error;
          successCount = data?.publishedTo || 0;
          console.log(`✅ Server fallback published to ${successCount}/${data?.totalRelays} relays`);
          if (successCount === 0) {
            const reasons = failedRelays
              .slice(0, 3)
              .map((r) => `${r.relay.replace('wss://', '')}: ${r.error}`)
              .join(' · ');
            throw new Error(`All relays failed (direct + server). ${reasons}`);
          }
        } catch (fallbackErr) {
          const reasons = failedRelays
            .slice(0, 3)
            .map((r) => `${r.relay.replace('wss://', '')}: ${r.error}`)
            .join(' · ');
          throw new Error(
            `Could not publish to any relay. ${reasons}${failedRelays.length > 3 ? ` (+${failedRelays.length - 3} more)` : ''}`,
          );
        }
      }

      toast({
        title: t('toast.eventPublished'),
        description: t('toast.eventPublishedDesc')
      });

      // Reset form
      setTitle("");
      setContent("");
      setSchedule([{ date: '', startTime: '', endTime: '' }]);
      setOnlineUrl("");
      setYoutubeUrl("");
      setYoutubeRecordingUrls([""]);
      setLocation("");
      setLat("");
      setLon("");
      setCapacity("");
      setCoverUrl("");
      removeCover();
      setDonationWallet("");
      setFiatValue("");
      setAttachments([""]);

    } catch (error) {
      console.error('Error publishing event:', error);
      toast({
        title: t('toast.errorPublishing'),
        description: error instanceof Error ? error.message : t('reg.unknownError'),
        variant: "destructive"
      });
    } finally {
      setPublishing(false);
    }
  };

  return (
    <div className="space-y-4 px-4">
      <div className="flex items-center gap-2 mb-6">
        <Calendar className="h-6 w-6 text-primary" />
        <h1 className="text-2xl font-bold">{t('form.addEvent')}</h1>
      </div>

      <form onSubmit={handleSubmit}>
        <Card className="mb-4">
          <CardHeader>
            <CardTitle className="text-lg flex items-center gap-2">
              <div className="flex items-center gap-4">
                <span>{t('form.eventType')}</span>
                <div className="flex items-center gap-2">
                  <MapPin className={`h-4 w-4 ${!isOnline ? 'text-primary' : 'text-muted-foreground'}`} />
                  <Switch
                    checked={isOnline}
                    onCheckedChange={setIsOnline}
                  />
                  <Globe className={`h-4 w-4 ${isOnline ? 'text-primary' : 'text-muted-foreground'}`} />
                </div>
                <span className="text-sm text-muted-foreground">
                  {isOnline ? t('form.online') : t('form.physical')}
                </span>
              </div>
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="title">{t('form.title')}</Label>
              <Input
                id="title"
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                placeholder={t('form.titlePlaceholder')}
                required
              />
            </div>

            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label htmlFor="eventType">{t('form.eventCategory')}</Label>
                <Select value={eventType} onValueChange={setEventType}>
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {EVENT_TYPES.map(type => (
                      <SelectItem key={type.value} value={type.value}>
                        {type.label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>

              <div className="space-y-2">
                <Label htmlFor="language">{t('form.language')}</Label>
                <Select value={language} onValueChange={setLanguage}>
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {LANGUAGES.map(lang => (
                      <SelectItem key={lang.value} value={lang.value}>
                        {lang.label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </div>

            <div className="space-y-2">
              <Label htmlFor="content">{t('form.description')}</Label>
              <Textarea
                id="content"
                value={content}
                onChange={(e) => setContent(e.target.value)}
                placeholder={t('form.descriptionPlaceholder')}
                rows={5}
              />
            </div>
          </CardContent>
        </Card>

        <Card className="mb-4">
          <CardHeader>
            <CardTitle className="text-lg">{t('form.dateTime')}</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="timezone">{t('form.timezone')}</Label>
              <Select value={timezone} onValueChange={setTimezone}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {COMMON_TIMEZONES.map(tz => (
                    <SelectItem key={tz.value} value={tz.value}>
                      {tz.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            {schedule.map((entry, idx) => (
              <div key={idx} className="border rounded-lg p-3 space-y-3">
                <div className="flex items-center justify-between">
                  <Label className="text-sm font-medium">
                    {schedule.length > 1 ? t('form.dayN', { n: String(idx + 1) }) : t('form.date')}
                  </Label>
                  {schedule.length > 1 && (
                    <Button
                      type="button"
                      variant="ghost"
                      size="icon"
                      className="h-6 w-6"
                      onClick={() => setSchedule(schedule.filter((_, i) => i !== idx))}
                    >
                      <X className="h-3 w-3" />
                    </Button>
                  )}
                </div>
                <div className="grid grid-cols-3 gap-2">
                  <div className="space-y-1">
                    <Label className="text-xs">{t('form.dateRequired')}</Label>
                    <Input
                      type="date"
                      value={entry.date}
                      onChange={(e) => {
                        const updated = [...schedule];
                        updated[idx] = { ...updated[idx], date: e.target.value };
                        setSchedule(updated);
                      }}
                      required={idx === 0}
                    />
                  </div>
                  <div className="space-y-1">
                    <Label className="text-xs">{t('form.startRequired')}</Label>
                    <Input
                      type="time"
                      value={entry.startTime}
                      onChange={(e) => {
                        const updated = [...schedule];
                        updated[idx] = { ...updated[idx], startTime: e.target.value };
                        setSchedule(updated);
                      }}
                      required={idx === 0}
                    />
                  </div>
                  <div className="space-y-1">
                    <Label className="text-xs">{t('form.end')}</Label>
                    <Input
                      type="time"
                      value={entry.endTime}
                      onChange={(e) => {
                        const updated = [...schedule];
                        updated[idx] = { ...updated[idx], endTime: e.target.value };
                        setSchedule(updated);
                      }}
                    />
                  </div>
                </div>
              </div>
            ))}

            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={() => setSchedule([...schedule, { date: '', startTime: '', endTime: '' }])}
              className="gap-2"
            >
              <Plus className="h-4 w-4" />
              {t('form.addDay')}
            </Button>
          </CardContent>
        </Card>

        {isOnline ? (
          <Card className="mb-4">
            <CardHeader>
              <CardTitle className="text-lg flex items-center gap-2">
                <Globe className="h-5 w-5" />
                {t('form.onlineDetails')}
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              {/* Lana Meet quick-create */}
              <div className="rounded-lg border border-violet-500/30 bg-violet-500/5 p-3 space-y-2">
                <div className="flex items-start gap-2">
                  <Video className="h-4 w-4 text-violet-500 flex-shrink-0 mt-0.5" />
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-medium">{t('form.lanaMeetCardTitle')}</p>
                    <p className="text-xs text-muted-foreground">
                      {t('form.lanaMeetCardDesc')}
                    </p>
                  </div>
                </div>
                <Button
                  type="button"
                  size="sm"
                  variant={lanaMeetCreated ? "outline" : "default"}
                  onClick={handleCreateLanaMeet}
                  disabled={creatingLanaMeet}
                  className="w-full"
                >
                  {creatingLanaMeet ? (
                    <Loader2 className="h-4 w-4 mr-1.5 animate-spin" />
                  ) : lanaMeetCreated ? (
                    <Check className="h-4 w-4 mr-1.5 text-green-500" />
                  ) : (
                    <Video className="h-4 w-4 mr-1.5" />
                  )}
                  {lanaMeetCreated ? t('form.lanaMeetCreated') : t('form.lanaMeetButton')}
                </Button>
              </div>

              {/* Lana Meet URL — auto-filled by Create button, but creators can also
                  paste an existing Lana Meet link they made earlier (e.g. via /meet/schedule). */}
              <div className="space-y-2">
                <Label htmlFor="onlineUrl">{t('form.lanaMeetUrlLabel')} <span className="text-destructive">*</span></Label>
                <div className="flex items-center gap-2">
                  <Input
                    id="onlineUrl"
                    type="url"
                    value={onlineUrl}
                    onChange={(e) => {
                      setOnlineUrl(e.target.value);
                      // Manual edits invalidate the "freshly-created via button" state
                      setLanaMeetCreated(false);
                    }}
                    placeholder="https://meet.lanaloves.us/..."
                    className="font-mono text-xs"
                  />
                  {onlineUrl && (
                    <Button
                      type="button"
                      size="icon"
                      variant="outline"
                      onClick={async () => {
                        try {
                          await navigator.clipboard.writeText(onlineUrl);
                          toast({ title: t('form.lanaMeetCopied') });
                        } catch { /* clipboard unavailable */ }
                      }}
                      title={t('form.lanaMeetCopy')}
                      className="flex-shrink-0"
                    >
                      <Copy className="h-4 w-4" />
                    </Button>
                  )}
                </div>
                {!onlineUrl && (
                  <p className="text-xs text-muted-foreground">
                    {t('form.lanaMeetUrlPlaceholder')}
                  </p>
                )}
              </div>
            </CardContent>
          </Card>
        ) : (
          <Card className="mb-4">
            <CardHeader>
              <CardTitle className="text-lg flex items-center gap-2">
                <MapPin className="h-5 w-5" />
                {t('form.locationDetails')}
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="space-y-2">
                <Label htmlFor="location">{t('form.locationName')}</Label>
                <Input
                  id="location"
                  value={location}
                  onChange={(e) => setLocation(e.target.value)}
                  placeholder="Cankarjev dom, Ljubljana"
                />
              </div>

              {/* Address search via OpenStreetMap Nominatim — port from shop.lanapays.us */}
              <AddressSearch
                onLocationChange={(newLat, newLon, displayName) => {
                  setLat(newLat);
                  setLon(newLon);
                  // Only auto-fill the location-name field if it's still empty —
                  // don't trample the user's hand-typed venue name.
                  if (displayName && !location.trim()) {
                    setLocation(displayName);
                  }
                }}
                labels={{
                  autoDetect: t('form.addressSearchAutoDetect'),
                  placeholder: t('form.addressSearchPlaceholder'),
                  noResults: t('form.addressSearchNoResults'),
                  selectLocation: t('form.addressSearchSelect'),
                  searchFailed: t('form.addressSearchFailed'),
                  permissionDenied: t('form.addressSearchPermissionDenied'),
                  geoUnavailable: t('form.addressSearchGeoUnavailable'),
                }}
              />

              <Button
                type="button"
                variant="outline"
                className="w-full"
                onClick={() => setShowMapPicker(true)}
              >
                <Map className="h-4 w-4 mr-2" />
                {t('form.selectOnMap')}
              </Button>

              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-2">
                  <Label htmlFor="lat">{t('form.latitude')}</Label>
                  <Input
                    id="lat"
                    value={lat}
                    onChange={(e) => setLat(e.target.value)}
                    placeholder="46.056946"
                    required={!isOnline}
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="lon">{t('form.longitude')}</Label>
                  <Input
                    id="lon"
                    value={lon}
                    onChange={(e) => setLon(e.target.value)}
                    placeholder="14.505751"
                    required={!isOnline}
                  />
                </div>
              </div>

              {/* Map preview when both coordinates are set */}
              {lat.trim() && lon.trim() && !isNaN(parseFloat(lat)) && !isNaN(parseFloat(lon)) && (
                <div className="rounded-lg overflow-hidden border">
                  <iframe
                    title="Map preview"
                    width="100%"
                    height="200"
                    style={{ border: 0 }}
                    loading="lazy"
                    src={`https://www.openstreetmap.org/export/embed.html?bbox=${parseFloat(lon) - 0.01},${parseFloat(lat) - 0.007},${parseFloat(lon) + 0.01},${parseFloat(lat) + 0.007}&layer=mapnik&marker=${lat},${lon}`}
                  />
                  <a
                    href={`https://www.openstreetmap.org/?mlat=${lat}&mlon=${lon}#map=16/${lat}/${lon}`}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="block text-xs text-primary text-center py-1.5 hover:underline border-t"
                  >
                    {t('form.openInOSM')}
                  </a>
                </div>
              )}

              <div className="space-y-2">
                <Label htmlFor="capacity">{t('form.capacity')}</Label>
                <Input
                  id="capacity"
                  type="number"
                  value={capacity}
                  onChange={(e) => setCapacity(e.target.value)}
                  placeholder="150"
                />
              </div>

              {/* Optional Lana Meet for physical events — allows people to also join online */}
              <div className="rounded-lg border border-violet-500/30 bg-violet-500/5 p-3 space-y-2">
                <div className="flex items-start gap-2">
                  <Video className="h-4 w-4 text-violet-500 flex-shrink-0 mt-0.5" />
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-medium">Lana Meet (online spremljanje) — opcijsko</p>
                    <p className="text-xs text-muted-foreground">
                      Ustvari povezavo, da se lahko ljudje pridružijo tudi online preko Lana Meet.
                    </p>
                  </div>
                </div>
                <Button
                  type="button"
                  size="sm"
                  variant={physicalLanaMeetCreated ? "outline" : "default"}
                  onClick={handleCreatePhysicalLanaMeet}
                  disabled={creatingPhysicalLanaMeet}
                  className="w-full"
                >
                  {creatingPhysicalLanaMeet ? (
                    <Loader2 className="h-4 w-4 mr-1.5 animate-spin" />
                  ) : physicalLanaMeetCreated ? (
                    <Check className="h-4 w-4 mr-1.5 text-green-500" />
                  ) : (
                    <Video className="h-4 w-4 mr-1.5" />
                  )}
                  {physicalLanaMeetCreated ? t('form.lanaMeetCreated') : t('form.lanaMeetButton')}
                </Button>

                <div className="space-y-2">
                  <Label htmlFor="lanaMeetUrl" className="text-xs">{t('form.lanaMeetUrlLabel')}</Label>
                  <div className="flex items-center gap-2">
                    <Input
                      id="lanaMeetUrl"
                      type="url"
                      value={lanaMeetUrl}
                      onChange={(e) => {
                        setLanaMeetUrl(e.target.value);
                        setPhysicalLanaMeetCreated(false);
                      }}
                      placeholder="https://meet.lanaloves.us/..."
                      className="font-mono text-xs"
                    />
                    {lanaMeetUrl && (
                      <Button
                        type="button"
                        size="icon"
                        variant="outline"
                        onClick={async () => {
                          try {
                            await navigator.clipboard.writeText(lanaMeetUrl);
                            toast({ title: t('form.lanaMeetCopied') });
                          } catch { /* clipboard unavailable */ }
                        }}
                        title={t('form.lanaMeetCopy')}
                        className="flex-shrink-0"
                      >
                        <Copy className="h-4 w-4" />
                      </Button>
                    )}
                  </div>
                </div>
              </div>
            </CardContent>
          </Card>
        )}

        {/* Map Picker Modal */}
        {showMapPicker && (
          <LocationPicker
            initialLat={lat ? parseFloat(lat) : (profileLat || undefined)}
            initialLng={lon ? parseFloat(lon) : (profileLng || undefined)}
            labels={{
              title: t('form.mapTitle'),
              hint: t('form.mapHint'),
              selected: t('form.mapSelected'),
              cancel: t('form.mapCancel'),
              confirm: t('form.mapConfirm'),
              myLocation: t('form.mapMyLocation'),
              locating: t('form.mapLocating'),
            }}
            onLocationSelect={(latitude, longitude) => {
              setLat(latitude.toFixed(6));
              setLon(longitude.toFixed(6));
            }}
            onClose={() => setShowMapPicker(false)}
          />
        )}

        {/* YouTube URLs — available for both online and physical events */}
        <Card className="mb-4">
          <CardContent className="space-y-4 pt-6">
            <div className="space-y-2">
              <Label htmlFor="youtubeUrl">{t('form.youtubePromoUrl')}</Label>
              <Input
                id="youtubeUrl"
                type="url"
                value={youtubeUrl}
                onChange={(e) => setYoutubeUrl(e.target.value)}
                placeholder="https://youtu.be/..."
              />
              <p className="text-xs text-muted-foreground">{t('form.youtubePromoHint')}</p>
            </div>

            <div className="space-y-2">
              <Label>{t('form.youtubeRecordingUrl')}</Label>
              <div className="space-y-2">
                {youtubeRecordingUrls.map((url, idx) => (
                  <div key={idx} className="flex gap-2">
                    <Input
                      type="url"
                      value={url}
                      onChange={(e) => {
                        const next = [...youtubeRecordingUrls];
                        next[idx] = e.target.value;
                        setYoutubeRecordingUrls(next);
                      }}
                      placeholder={idx === 0 ? "https://youtu.be/XYZ123" : `https://youtu.be/... (#${idx + 1})`}
                    />
                    {youtubeRecordingUrls.length > 1 && (
                      <Button
                        type="button"
                        variant="ghost"
                        size="icon"
                        onClick={() => {
                          setYoutubeRecordingUrls(youtubeRecordingUrls.filter((_, i) => i !== idx));
                        }}
                        title={t('form.recordingRemove')}
                      >
                        <Trash2 className="h-4 w-4 text-destructive" />
                      </Button>
                    )}
                  </div>
                ))}
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={() => setYoutubeRecordingUrls([...youtubeRecordingUrls, ""])}
                  className="gap-2"
                >
                  <Plus className="h-4 w-4" />
                  {t('form.recordingAdd')}
                </Button>
              </div>
              <p className="text-xs text-muted-foreground">{t('form.youtubeRecordingHint')}</p>
            </div>
          </CardContent>
        </Card>

        <Card className="mb-4">
          <CardHeader>
            <CardTitle className="text-lg flex items-center gap-2">
              <ImagePlus className="h-5 w-5" />
              {t('form.coverImage')}
              <span className="text-red-500 text-sm">*</span>
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            {coverPreview ? (
              <div className="relative">
                <img 
                  src={coverPreview} 
                  alt="Cover preview" 
                  className="w-full h-48 object-cover rounded-lg"
                />
                <Button
                  type="button"
                  variant="destructive"
                  size="icon"
                  className="absolute top-2 right-2"
                  onClick={removeCover}
                >
                  <X className="h-4 w-4" />
                </Button>
              </div>
            ) : (
              <>
                <div className="space-y-2">
                  <Label>{t('form.uploadImage')}</Label>
                  <Input
                    type="file"
                    accept="image/*"
                    onChange={handleCoverSelect}
                  />
                </div>
                <div className="text-center text-muted-foreground text-sm">{t('form.or')}</div>
                <div className="space-y-2">
                  <Label htmlFor="coverUrl">{t('form.imageUrl')}</Label>
                  <Input
                    id="coverUrl"
                    type="url"
                    value={coverUrl}
                    onChange={(e) => setCoverUrl(e.target.value)}
                    placeholder="https://..."
                  />
                </div>
              </>
            )}
          </CardContent>
        </Card>

        <Card className="mb-4">
          <CardHeader>
            <CardTitle className="text-lg flex items-center gap-2">
              <Link2 className="h-5 w-5" />
              {t('form.attachments')}
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            {attachments.map((url, index) => (
              <div key={index} className="flex gap-2">
                <Input
                  value={url}
                  onChange={(e) => updateAttachment(index, e.target.value)}
                  placeholder="https://example.com/document.pdf"
                />
                {attachments.length > 1 && (
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon"
                    onClick={() => removeAttachment(index)}
                  >
                    <X className="h-4 w-4" />
                  </Button>
                )}
              </div>
            ))}
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={addAttachment}
              className="gap-2"
            >
              <Plus className="h-4 w-4" />
              {t('form.addAttachment')}
            </Button>
          </CardContent>
        </Card>

        <Card className="mb-4">
          <CardHeader>
            <CardTitle className="text-lg">{t('form.optionalDetails')}</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="space-y-2">
              <Label className="flex items-center gap-2">
                <Wallet className="h-4 w-4" />
                {t('form.registeredWallet')}
              </Label>
              <Select
                value={donationWallet || "none"}
                onValueChange={(val) => setDonationWallet(val === "none" ? "" : val)}
              >
                <SelectTrigger>
                  <SelectValue placeholder={walletsLoading ? t('form.loadingWallets') : t('form.selectRegisteredWallet')} />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="none">{t('form.noWallet')}</SelectItem>
                  {availableWallets.map((wallet) => (
                    <SelectItem key={wallet.walletId} value={wallet.walletId}>
                      <div className="flex flex-col">
                        <span className="font-mono text-sm">{wallet.walletId}</span>
                        <span className="text-xs text-muted-foreground">
                          {wallet.walletType}{wallet.note ? ` - ${wallet.note}` : ''}
                        </span>
                      </div>
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-2">
              <Label className="flex items-center gap-2">
                <Wallet className="h-4 w-4" />
                {t('form.unregisteredWallet')}
              </Label>
              <Select
                value={donationWalletUnreg || "none"}
                onValueChange={(val) => setDonationWalletUnreg(val === "none" ? "" : val)}
              >
                <SelectTrigger>
                  <SelectValue placeholder={unregLoading ? t('form.loadingWallets') : t('form.selectUnregisteredWallet')} />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="none">{t('form.noWallet')}</SelectItem>
                  {myUnregWallets.map((wallet) => (
                    <SelectItem key={wallet.address} value={wallet.address}>
                      <div className="flex flex-col">
                        <span className="font-mono text-sm">{wallet.address}</span>
                        {wallet.note && (
                          <span className="text-xs text-muted-foreground">{wallet.note}</span>
                        )}
                      </div>
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-2">
              <Label htmlFor="fiatValue">{t('form.eventValueEur')}</Label>
              <Input
                id="fiatValue"
                type="number"
                value={fiatValue}
                onChange={(e) => setFiatValue(e.target.value)}
                placeholder="20"
              />
            </div>
          </CardContent>
        </Card>

        <Button 
          type="submit" 
          className="w-full" 
          disabled={publishing || uploading}
        >
          {(publishing || uploading) && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
          {uploading ? t('form.uploading') : publishing ? t('form.publishing') : t('form.publishEvent')}
        </Button>
      </form>
    </div>
  );
}
