import { useState, useEffect, useCallback } from "react";
import { useParams, useNavigate } from "react-router-dom";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { Skeleton } from "@/components/ui/skeleton";
import { Loader2, Plus, X, Calendar, MapPin, Globe, Link2, ImagePlus, ArrowLeft, Wallet, Map, Trash2, Video, Copy, Check } from "lucide-react";
import { useAuth } from "@/contexts/AuthContext";
import LocationPicker from "@/components/LocationPicker";
import { AddressSearch } from "@/components/AddressSearch";
import { useSystemParameters } from "@/contexts/SystemParametersContext";
import { SimplePool, finalizeEvent } from "nostr-tools";
import { toast } from "@/hooks/use-toast";
import { supabase } from "@/integrations/supabase/client";
import { format } from "date-fns";
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

// Build NIP-22242 auth token (same shape as AddEvent.tsx)
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

export default function EditEvent() {
  const { eventId } = useParams();
  const navigate = useNavigate();
  const { session } = useAuth();
  const { parameters: systemParameters } = useSystemParameters();
  const { wallets, isLoading: walletsLoading } = useNostrWallets();
  const { lists: unregLists, isLoading: unregLoading } = useNostrUnregisteredWallets();
  const { profile: userProfile } = useNostrProfileCache(session?.nostrHexId || null);
  const { t } = useTranslation(eventsTranslations);

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
  
  const [loading, setLoading] = useState(true);
  const [isOnline, setIsOnline] = useState(true);
  const [publishing, setPublishing] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [originalDTag, setOriginalDTag] = useState("");
  
  // Form state
  const [title, setTitle] = useState("");
  const [content, setContent] = useState("");
  const [eventType, setEventType] = useState("awareness");
  const [language, setLanguage] = useState("sl");
  const [timezone, setTimezone] = useState(DEFAULT_TIMEZONE);
  const [schedule, setSchedule] = useState<Array<{date: string; startTime: string; endTime: string}>>([
    { date: '', startTime: '', endTime: '' }
  ]);
  const [status, setStatus] = useState<'active' | 'archived' | 'canceled'>('active');
  
  // Online fields
  const [onlineUrl, setOnlineUrl] = useState("");
  // Lana Meet quick-create for online events (auto-fills the online URL)
  const [creatingLanaMeet, setCreatingLanaMeet] = useState(false);
  const [lanaMeetCreated, setLanaMeetCreated] = useState(false);
  const [youtubeUrl, setYoutubeUrl] = useState("");
  const [youtubeRecordingUrls, setYoutubeRecordingUrls] = useState<string[]>([""]);
  
  // Physical fields
  const [location, setLocation] = useState("");
  const [lat, setLat] = useState("");
  const [lon, setLon] = useState("");
  const [capacity, setCapacity] = useState("");
  const [showMapPicker, setShowMapPicker] = useState(false);
  // Optional Lana Meet for physical events (so people can also join online)
  const [lanaMeetUrl, setLanaMeetUrl] = useState("");
  const [creatingPhysicalLanaMeet, setCreatingPhysicalLanaMeet] = useState(false);
  const [physicalLanaMeetCreated, setPhysicalLanaMeetCreated] = useState(false);

  // Optional fields
  const [coverUrl, setCoverUrl] = useState("");
  const [coverFile, setCoverFile] = useState<File | null>(null);
  const [coverPreview, setCoverPreview] = useState("");
  const [donationWallet, setDonationWallet] = useState("");
  const [donationWalletUnreg, setDonationWalletUnreg] = useState("");
  const [fiatValue, setFiatValue] = useState("");
  const [attachments, setAttachments] = useState<string[]>([""]);
  
  const relays = systemParameters?.relays || [];

  const fetchEvent = useCallback(async () => {
    if (!eventId || !session?.nostrHexId) {
      setLoading(false);
      return;
    }

    try {
      const pool = new SimplePool();
      const rawEvents = await pool.querySync(relays, {
        kinds: [36677],
        ids: [eventId]
      });

      if (rawEvents.length === 0) {
        toast({ title: t('toast.eventNotFound'), variant: "destructive" });
        navigate('/events/my');
        return;
      }

      const event = rawEvents[0];
      
      // Check ownership
      if (event.pubkey !== session.nostrHexId) {
        toast({ title: t('toast.onlyEditOwn'), variant: "destructive" });
        navigate('/events/my');
        return;
      }

      const tags = event.tags || [];
      const getTagValue = (name: string): string | undefined => {
        const tag = tags.find((t: string[]) => t[0] === name);
        return tag ? tag[1] : undefined;
      };
      const getAllTagValues = (name: string): string[] => {
        return tags.filter((t: string[]) => t[0] === name).map((t: string[]) => t[1]);
      };

      // Populate form
      setOriginalDTag(getTagValue('d') || '');
      setTitle(getTagValue('title') || '');
      setContent(event.content || '');
      setEventType(getTagValue('event_type') || 'awareness');
      setLanguage(getTagValue('language') || 'sl');
      setTimezone(getTagValue('timezone') || DEFAULT_TIMEZONE);
      setStatus((getTagValue('status') as 'active' | 'archived' | 'canceled') || 'active');

      // Load schedule entries
      const scheduleTags = tags.filter((t: string[]) => t[0] === 'schedule');
      if (scheduleTags.length > 0) {
        const loadedSchedule = scheduleTags
          .map((t: string[]) => {
            const s = new Date(t[1]);
            if (isNaN(s.getTime())) return null;
            const e = t[2] ? new Date(t[2]) : undefined;
            return {
              date: format(s, 'yyyy-MM-dd'),
              startTime: format(s, 'HH:mm'),
              endTime: e && !isNaN(e.getTime()) ? format(e, 'HH:mm') : ''
            };
          })
          .filter((e): e is {date: string; startTime: string; endTime: string} => e !== null)
          .sort((a, b) => `${a.date}T${a.startTime}`.localeCompare(`${b.date}T${b.startTime}`));
        if (loadedSchedule.length > 0) {
          setSchedule(loadedSchedule);
        }
      } else {
        // Fallback: load from start/end for legacy events
        const startStr = getTagValue('start');
        if (startStr) {
          const startDt = new Date(startStr);
          const endStr = getTagValue('end');
          const endDt = endStr ? new Date(endStr) : undefined;
          setSchedule([{
            date: format(startDt, 'yyyy-MM-dd'),
            startTime: format(startDt, 'HH:mm'),
            endTime: endDt && !isNaN(endDt.getTime()) ? format(endDt, 'HH:mm') : ''
          }]);
        }
      }

      const onlineUrlValue = getTagValue('online');
      if (onlineUrlValue) {
        setIsOnline(true);
        setOnlineUrl(onlineUrlValue);
      } else {
        setIsOnline(false);
        setLat(getTagValue('lat') || '');
        setLon(getTagValue('lon') || '');
        setLocation(getTagValue('location') || '');
        setCapacity(getTagValue('capacity') || '');
        // Load optional Lana Meet URL for physical events
        setLanaMeetUrl(getTagValue('lana_meet') || '');
      }

      // YouTube URLs — loaded for both online and physical events
      setYoutubeUrl(getTagValue('youtube') || '');
      const recordings = getAllTagValues('youtube_recording').filter(Boolean);
      setYoutubeRecordingUrls(recordings.length > 0 ? recordings : ['']);

      setCoverUrl(getTagValue('cover') || '');
      if (getTagValue('cover')) {
        setCoverPreview(getTagValue('cover') || '');
      }
      // Load both wallet types
      const dwReg = getTagValue('donation_wallet') || '';
      const dwUnreg = getTagValue('donation_wallet_unreg') || '';
      const dwType = getTagValue('donation_wallet_type') as 'registered' | 'unregistered' | undefined;

      // Backward compat: old events stored both types in donation_wallet + donation_wallet_type
      if (dwReg && !dwUnreg && dwType === 'unregistered') {
        // Old event with unregistered wallet stored in donation_wallet
        setDonationWalletUnreg(dwReg);
        setDonationWallet('');
      } else {
        setDonationWallet(dwReg);
        setDonationWalletUnreg(dwUnreg);
      }
      setFiatValue(getTagValue('fiat_value') || '');
      
      const attachmentUrls = getAllTagValues('attachment');
      setAttachments(attachmentUrls.length > 0 ? attachmentUrls : ['']);

    } catch (err) {
      console.error('Error fetching event:', err);
      toast({ title: t('toast.errorLoading'), variant: "destructive" });
    } finally {
      setLoading(false);
    }
  }, [eventId, session?.nostrHexId, relays, navigate]);

  useEffect(() => {
    fetchEvent();
  }, [fetchEvent]);

  const handleCoverSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) {
      setCoverFile(file);
      setCoverPreview(URL.createObjectURL(file));
      setCoverUrl("");
    }
  };

  const removeCover = () => {
    if (coverPreview && !coverPreview.startsWith('http')) {
      URL.revokeObjectURL(coverPreview);
    }
    setCoverFile(null);
    setCoverPreview("");
    setCoverUrl("");
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

  // Lana Meet creation for online events — auto-fills the online URL field
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
        description: t('toast.loginToUpdate'),
        variant: "destructive"
      });
      return;
    }

    if (!originalDTag) {
      toast({ title: t('reg.error'), description: t('toast.originalNotFound'), variant: "destructive" });
      return;
    }

    // Validation
    if (!title.trim()) {
      toast({ title: t('reg.error'), description: t('toast.titleRequired'), variant: "destructive" });
      return;
    }
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

    try {
      setPublishing(true);

      // Upload cover if file selected
      let finalCoverUrl = coverUrl || coverPreview;
      if (coverFile) {
        const uploadedUrl = await uploadCoverImage();
        if (uploadedUrl) {
          finalCoverUrl = uploadedUrl;
        }
      }

      const pool = new SimplePool();
      const privKeyBytes = new Uint8Array(session.nostrPrivateKey.match(/.{1,2}/g)!.map(byte => parseInt(byte, 16)));

      // Sort valid schedule entries
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
        ["d", originalDTag],
        ["title", title.trim()],
        ["status", status],
        ["start", startDateTime],
        ["language", language],
        ["event_type", eventType],
        ["p", session.nostrHexId],
        ["timezone", timezone]
      ];

      if (endDateTime) {
        tags.push(["end", endDateTime]);
      }

      // Add schedule tags for multi-day events
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
        // Optional Lana Meet URL for physical events — preserve on edit
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

      if (finalCoverUrl && finalCoverUrl.trim()) {
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

      console.log('Publishing updated event to relays:', relays);

      const publishPromises = pool.publish(relays, event);
      const publishArray = Array.from(publishPromises);
      let successCount = 0;
      let errorCount = 0;

      await new Promise<void>((resolve, reject) => {
        const timeout = setTimeout(() => {
          if (successCount === 0) {
            reject(new Error('Publish timeout - no relays responded'));
          } else {
            resolve();
          }
        }, 10000);

        publishArray.forEach((promise) => {
          promise
            .then(() => {
              successCount++;
              if (successCount === 1) {
                clearTimeout(timeout);
                resolve();
              }
            })
            .catch(() => {
              errorCount++;
              if (errorCount === publishArray.length) {
                clearTimeout(timeout);
                reject(new Error('All relays failed to publish'));
              }
            });
        });
      });

      toast({
        title: t('toast.eventUpdated'),
        description: t('toast.eventUpdatedDesc')
      });

      navigate('/events/my');

    } catch (error) {
      console.error('Error publishing event:', error);
      toast({
        title: t('toast.errorUpdating'),
        description: error instanceof Error ? error.message : t('reg.unknownError'),
        variant: "destructive"
      });
    } finally {
      setPublishing(false);
    }
  };

  if (loading) {
    return (
      <div className="space-y-4 px-4">
        <Skeleton className="h-8 w-48" />
        <Skeleton className="h-64 w-full" />
        <Skeleton className="h-48 w-full" />
      </div>
    );
  }

  return (
    <div className="space-y-4 px-4 pb-24">
      <div className="flex items-center gap-2 mb-6">
        <Button variant="ghost" size="icon" onClick={() => navigate('/events/my')}>
          <ArrowLeft className="h-5 w-5" />
        </Button>
        <Calendar className="h-6 w-6 text-primary" />
        <h1 className="text-2xl font-bold">{t('form.editEvent')}</h1>
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
              <Label htmlFor="status">{t('form.status')}</Label>
              <Select value={status} onValueChange={(v) => setStatus(v as 'active' | 'archived' | 'canceled')}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="active">{t('form.statusActive')}</SelectItem>
                  <SelectItem value="archived">{t('form.statusArchived')}</SelectItem>
                  <SelectItem value="canceled">{t('form.statusCanceled')}</SelectItem>
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-2">
              <Label htmlFor="content">{t('form.description')}</Label>
              <Textarea
                id="content"
                value={content}
                onChange={(e) => setContent(e.target.value)}
                placeholder={t('form.descriptionPlaceholder')}
                rows={10}
                className="min-h-[200px]"
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
              {/* Lana Meet quick-create — generate a new meeting link for this online event */}
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

              <div className="space-y-2">
                <Label htmlFor="onlineUrl">{t('form.eventUrlEdit')}</Label>
                <div className="flex items-center gap-2">
                  <Input
                    id="onlineUrl"
                    type="url"
                    value={onlineUrl}
                    onChange={(e) => {
                      setOnlineUrl(e.target.value);
                      setLanaMeetCreated(false);
                    }}
                    placeholder="https://mejmosefajn.org/room/events"
                    required={isOnline}
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

              {/* Address search via OpenStreetMap Nominatim */}
              <AddressSearch
                onLocationChange={(newLat, newLon, displayName) => {
                  setLat(newLat);
                  setLon(newLon);
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
          {uploading ? t('form.uploading') : publishing ? t('form.saving') : t('form.saveChanges')}
        </Button>
      </form>
    </div>
  );
}
