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
import { Loader2, Plus, X, Calendar, MapPin, Globe, Link2, ImagePlus, ArrowLeft, Wallet } from "lucide-react";
import { useAuth } from "@/contexts/AuthContext";
import { useSystemParameters } from "@/contexts/SystemParametersContext";
import { SimplePool, finalizeEvent } from "nostr-tools";
import { toast } from "@/hooks/use-toast";
import { supabase } from "@/integrations/supabase/client";
import { format } from "date-fns";
import { useNostrWallets } from "@/hooks/useNostrWallets";
import { useNostrUnregisteredWallets } from "@/hooks/useNostrUnregisteredWallets";
import { COMMON_TIMEZONES, DEFAULT_TIMEZONE, getTimezoneOffset } from "@/lib/timezones";

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

export default function EditEvent() {
  const { eventId } = useParams();
  const navigate = useNavigate();
  const { session } = useAuth();
  const { parameters: systemParameters } = useSystemParameters();
  const { wallets, isLoading: walletsLoading } = useNostrWallets();
  const { lists: unregLists, isLoading: unregLoading } = useNostrUnregisteredWallets();

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
  const [startDate, setStartDate] = useState("");
  const [startTime, setStartTime] = useState("");
  const [endDate, setEndDate] = useState("");
  const [endTime, setEndTime] = useState("");
  const [status, setStatus] = useState<'active' | 'archived' | 'canceled'>('active');
  
  // Online fields
  const [onlineUrl, setOnlineUrl] = useState("");
  const [youtubeUrl, setYoutubeUrl] = useState("");
  const [youtubeRecordingUrl, setYoutubeRecordingUrl] = useState("");
  
  // Physical fields
  const [location, setLocation] = useState("");
  const [lat, setLat] = useState("");
  const [lon, setLon] = useState("");
  const [capacity, setCapacity] = useState("");
  
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
        toast({ title: "Event not found", variant: "destructive" });
        navigate('/events/my');
        return;
      }

      const event = rawEvents[0];
      
      // Check ownership
      if (event.pubkey !== session.nostrHexId) {
        toast({ title: "You can only edit your own events", variant: "destructive" });
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

      const startStr = getTagValue('start');
      if (startStr) {
        const startDt = new Date(startStr);
        setStartDate(format(startDt, 'yyyy-MM-dd'));
        setStartTime(format(startDt, 'HH:mm'));
      }

      const endStr = getTagValue('end');
      if (endStr) {
        const endDt = new Date(endStr);
        setEndDate(format(endDt, 'yyyy-MM-dd'));
        setEndTime(format(endDt, 'HH:mm'));
      }

      const onlineUrlValue = getTagValue('online');
      if (onlineUrlValue) {
        setIsOnline(true);
        setOnlineUrl(onlineUrlValue);
        setYoutubeUrl(getTagValue('youtube') || '');
        setYoutubeRecordingUrl(getTagValue('youtube_recording') || '');
      } else {
        setIsOnline(false);
        setLat(getTagValue('lat') || '');
        setLon(getTagValue('lon') || '');
        setLocation(getTagValue('location') || '');
        setCapacity(getTagValue('capacity') || '');
      }

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
      toast({ title: "Error loading event", variant: "destructive" });
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
        title: "Error uploading cover image",
        description: error instanceof Error ? error.message : "Unknown error",
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

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    
    if (!session?.nostrPrivateKey || !session?.nostrHexId) {
      toast({
        title: "Error",
        description: "You must be logged in to update an event",
        variant: "destructive"
      });
      return;
    }

    if (!originalDTag) {
      toast({ title: "Error", description: "Could not find original event", variant: "destructive" });
      return;
    }

    // Validation
    if (!title.trim()) {
      toast({ title: "Error", description: "Title is required", variant: "destructive" });
      return;
    }
    if (!startDate || !startTime) {
      toast({ title: "Error", description: "Start date and time are required", variant: "destructive" });
      return;
    }
    if (isOnline && !onlineUrl.trim()) {
      toast({ title: "Error", description: "Online URL is required for online events", variant: "destructive" });
      return;
    }
    if (!isOnline && (!lat.trim() || !lon.trim())) {
      toast({ title: "Error", description: "Coordinates are required for physical events", variant: "destructive" });
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

      // Use the original d tag to make this a replaceable event
      const tzOffset = getTimezoneOffset(timezone, new Date(`${startDate}T${startTime}`));
      const startDateTime = `${startDate}T${startTime}:00${tzOffset}`;
      const endDateTime = endDate && endTime ? `${endDate}T${endTime}:00${tzOffset}` : null;

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

      if (isOnline) {
        tags.push(["online", onlineUrl.trim()]);
        if (youtubeUrl.trim()) {
          tags.push(["youtube", youtubeUrl.trim()]);
        }
        // Add youtube_recording with auto-correct for missing protocol
        let recordingUrl = youtubeRecordingUrl.trim();
        if (recordingUrl && !recordingUrl.startsWith('http://') && !recordingUrl.startsWith('https://')) {
          recordingUrl = 'https://' + recordingUrl;
        }
        if (recordingUrl) {
          tags.push(["youtube_recording", recordingUrl]);
        }
      } else {
        tags.push(["lat", lat.trim()]);
        tags.push(["lon", lon.trim()]);
        if (location.trim()) {
          tags.push(["location", location.trim()]);
        }
        if (capacity.trim()) {
          tags.push(["capacity", capacity.trim()]);
        }
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
        title: "Event Updated!",
        description: "Your event was successfully updated"
      });

      navigate('/events/my');

    } catch (error) {
      console.error('Error publishing event:', error);
      toast({
        title: "Error updating event",
        description: error instanceof Error ? error.message : "Unknown error",
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
        <h1 className="text-2xl font-bold">Edit Event</h1>
      </div>

      <form onSubmit={handleSubmit}>
        <Card className="mb-4">
          <CardHeader>
            <CardTitle className="text-lg flex items-center gap-2">
              <div className="flex items-center gap-4">
                <span>Event Type</span>
                <div className="flex items-center gap-2">
                  <MapPin className={`h-4 w-4 ${!isOnline ? 'text-primary' : 'text-muted-foreground'}`} />
                  <Switch
                    checked={isOnline}
                    onCheckedChange={setIsOnline}
                  />
                  <Globe className={`h-4 w-4 ${isOnline ? 'text-primary' : 'text-muted-foreground'}`} />
                </div>
                <span className="text-sm text-muted-foreground">
                  {isOnline ? 'Online' : 'Physical'}
                </span>
              </div>
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="title">Title *</Label>
              <Input
                id="title"
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                placeholder="Event title"
                required
              />
            </div>

            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label htmlFor="eventType">Event Category *</Label>
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
                <Label htmlFor="language">Language *</Label>
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
              <Label htmlFor="status">Status</Label>
              <Select value={status} onValueChange={(v) => setStatus(v as 'active' | 'archived' | 'canceled')}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="active">Active</SelectItem>
                  <SelectItem value="archived">Archived</SelectItem>
                  <SelectItem value="canceled">Canceled</SelectItem>
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-2">
              <Label htmlFor="content">Description</Label>
              <Textarea
                id="content"
                value={content}
                onChange={(e) => setContent(e.target.value)}
                placeholder="Event description, agenda, instructions..."
                rows={10}
                className="min-h-[200px]"
              />
            </div>
          </CardContent>
        </Card>

        <Card className="mb-4">
          <CardHeader>
            <CardTitle className="text-lg">Date & Time</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="timezone">Timezone *</Label>
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

            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label htmlFor="startDate">Start Date *</Label>
                <Input
                  id="startDate"
                  type="date"
                  value={startDate}
                  onChange={(e) => setStartDate(e.target.value)}
                  required
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="startTime">Start Time *</Label>
                <Input
                  id="startTime"
                  type="time"
                  value={startTime}
                  onChange={(e) => setStartTime(e.target.value)}
                  required
                />
              </div>
            </div>

            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label htmlFor="endDate">End Date</Label>
                <Input
                  id="endDate"
                  type="date"
                  value={endDate}
                  onChange={(e) => setEndDate(e.target.value)}
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="endTime">End Time</Label>
                <Input
                  id="endTime"
                  type="time"
                  value={endTime}
                  onChange={(e) => setEndTime(e.target.value)}
                />
              </div>
            </div>
          </CardContent>
        </Card>

        {isOnline ? (
          <Card className="mb-4">
            <CardHeader>
              <CardTitle className="text-lg flex items-center gap-2">
                <Globe className="h-5 w-5" />
                Online Details
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="space-y-2">
                <Label htmlFor="onlineUrl">Event URL *</Label>
                <Input
                  id="onlineUrl"
                  type="url"
                  value={onlineUrl}
                  onChange={(e) => setOnlineUrl(e.target.value)}
                  placeholder="https://mejmosefajn.org/room/events"
                  required={isOnline}
                />
              </div>

              <div className="space-y-2">
                <Label htmlFor="youtubeUrl">YouTube Promo URL (optional)</Label>
                <Input
                  id="youtubeUrl"
                  type="url"
                  value={youtubeUrl}
                  onChange={(e) => setYoutubeUrl(e.target.value)}
                  placeholder="https://youtu.be/..."
                />
                <p className="text-xs text-muted-foreground">Promo video pred dogodkom</p>
              </div>

              <div className="space-y-2">
                <Label htmlFor="youtubeRecordingUrl">YouTube Recording Link (optional)</Label>
                <Input
                  id="youtubeRecordingUrl"
                  type="url"
                  value={youtubeRecordingUrl}
                  onChange={(e) => setYoutubeRecordingUrl(e.target.value)}
                  placeholder="https://youtu.be/XYZ123"
                />
                <p className="text-xs text-muted-foreground">Use this only after the event has ended. This is the final recording participants can rewatch.</p>
              </div>
            </CardContent>
          </Card>
        ) : (
          <Card className="mb-4">
            <CardHeader>
              <CardTitle className="text-lg flex items-center gap-2">
                <MapPin className="h-5 w-5" />
                Location Details
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="space-y-2">
                <Label htmlFor="location">Location Name</Label>
                <Input
                  id="location"
                  value={location}
                  onChange={(e) => setLocation(e.target.value)}
                  placeholder="Cankarjev dom, Ljubljana"
                />
              </div>

              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-2">
                  <Label htmlFor="lat">Latitude *</Label>
                  <Input
                    id="lat"
                    value={lat}
                    onChange={(e) => setLat(e.target.value)}
                    placeholder="46.056946"
                    required={!isOnline}
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="lon">Longitude *</Label>
                  <Input
                    id="lon"
                    value={lon}
                    onChange={(e) => setLon(e.target.value)}
                    placeholder="14.505751"
                    required={!isOnline}
                  />
                </div>
              </div>

              <div className="space-y-2">
                <Label htmlFor="capacity">Capacity</Label>
                <Input
                  id="capacity"
                  type="number"
                  value={capacity}
                  onChange={(e) => setCapacity(e.target.value)}
                  placeholder="150"
                />
              </div>
            </CardContent>
          </Card>
        )}

        <Card className="mb-4">
          <CardHeader>
            <CardTitle className="text-lg flex items-center gap-2">
              <ImagePlus className="h-5 w-5" />
              Cover Image
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
                  <Label>Upload Image</Label>
                  <Input
                    type="file"
                    accept="image/*"
                    onChange={handleCoverSelect}
                  />
                </div>
                <div className="text-center text-muted-foreground text-sm">or</div>
                <div className="space-y-2">
                  <Label htmlFor="coverUrl">Image URL</Label>
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
              Attachments
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
              Add Attachment
            </Button>
          </CardContent>
        </Card>

        <Card className="mb-4">
          <CardHeader>
            <CardTitle className="text-lg">Optional Details</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="space-y-2">
              <Label className="flex items-center gap-2">
                <Wallet className="h-4 w-4" />
                Registered LANA Wallet
              </Label>
              <Select
                value={donationWallet || "none"}
                onValueChange={(val) => setDonationWallet(val === "none" ? "" : val)}
              >
                <SelectTrigger>
                  <SelectValue placeholder={walletsLoading ? "Loading wallets..." : "Select registered wallet"} />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="none">No wallet</SelectItem>
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
                Unregistered LANA Wallet
              </Label>
              <Select
                value={donationWalletUnreg || "none"}
                onValueChange={(val) => setDonationWalletUnreg(val === "none" ? "" : val)}
              >
                <SelectTrigger>
                  <SelectValue placeholder={unregLoading ? "Loading wallets..." : "Select unregistered wallet"} />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="none">No wallet</SelectItem>
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
              <Label htmlFor="fiatValue">Event Value (EUR)</Label>
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
          {uploading ? 'Uploading...' : publishing ? 'Saving...' : 'Save Changes'}
        </Button>
      </form>
    </div>
  );
}
