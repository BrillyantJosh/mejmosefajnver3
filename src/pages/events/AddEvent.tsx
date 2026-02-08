import { useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { Loader2, Plus, X, Calendar, MapPin, Globe, Link2, ImagePlus, Wallet } from "lucide-react";
import { useAuth } from "@/contexts/AuthContext";
import { useSystemParameters } from "@/contexts/SystemParametersContext";
import { SimplePool, finalizeEvent } from "nostr-tools";
import { toast } from "@/hooks/use-toast";
import { supabase } from "@/integrations/supabase/client";
import { useNostrWallets } from "@/hooks/useNostrWallets";
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

export default function AddEvent() {
  const { session } = useAuth();
  const { parameters: systemParameters } = useSystemParameters();
  const { wallets, isLoading: walletsLoading } = useNostrWallets();
  
  // Filter out excluded wallet types
  const EXCLUDED_WALLET_TYPES = ['LanaPays.Us', 'Knights', 'Lana8Wonder'];
  const availableWallets = wallets.filter(
    w => w.status === 'active' && !EXCLUDED_WALLET_TYPES.includes(w.walletType)
  );
  
  const [isOnline, setIsOnline] = useState(true);
  const [publishing, setPublishing] = useState(false);
  const [uploading, setUploading] = useState(false);
  
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
  
  // Online fields
  const [onlineUrl, setOnlineUrl] = useState("");
  const [youtubeUrl, setYoutubeUrl] = useState("");
  
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
  const [fiatValue, setFiatValue] = useState("");
  const [attachments, setAttachments] = useState<string[]>([""]);
  
  const relays = systemParameters?.relays || [];

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
        description: "You must be logged in to create an event",
        variant: "destructive"
      });
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
      
      // Format datetime with timezone offset
      const tzOffset = getTimezoneOffset(timezone, new Date(`${startDate}T${startTime}`));
      const startDateTime = `${startDate}T${startTime}:00${tzOffset}`;
      const endDateTime = endDate && endTime ? `${endDate}T${endTime}:00${tzOffset}` : null;

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

      // Add location-specific tags
      if (isOnline) {
        tags.push(["online", onlineUrl.trim()]);
        if (youtubeUrl.trim()) {
          tags.push(["youtube", youtubeUrl.trim()]);
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

      // Optional tags
      if (finalCoverUrl.trim()) {
        tags.push(["cover", finalCoverUrl.trim()]);
      }
      if (donationWallet.trim()) {
        tags.push(["donation_wallet", donationWallet.trim()]);
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

      console.log('Publishing event to relays:', relays);
      console.log('Event:', event);

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
        title: "Event Published!",
        description: "Your event was successfully published to the network"
      });

      // Reset form
      setTitle("");
      setContent("");
      setStartDate("");
      setStartTime("");
      setEndDate("");
      setEndTime("");
      setOnlineUrl("");
      setYoutubeUrl("");
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
        title: "Error publishing event",
        description: error instanceof Error ? error.message : "Unknown error",
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
        <h1 className="text-2xl font-bold">Add Event</h1>
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
              <Label htmlFor="content">Description</Label>
              <Textarea
                id="content"
                value={content}
                onChange={(e) => setContent(e.target.value)}
                placeholder="Event description, agenda, instructions..."
                rows={5}
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
                <Label htmlFor="onlineUrl">Google Meet / Event URL *</Label>
                <Input
                  id="onlineUrl"
                  type="url"
                  value={onlineUrl}
                  onChange={(e) => setOnlineUrl(e.target.value)}
                  placeholder="https://meet.google.com/xxx-xxxx-xxx"
                  required={isOnline}
                />
              </div>

              <div className="space-y-2">
                <Label htmlFor="youtubeUrl">YouTube URL (optional)</Label>
                <Input
                  id="youtubeUrl"
                  type="url"
                  value={youtubeUrl}
                  onChange={(e) => setYoutubeUrl(e.target.value)}
                  placeholder="https://youtu.be/..."
                />
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
              <Label htmlFor="donationWallet" className="flex items-center gap-2">
                <Wallet className="h-4 w-4" />
                LANA Donation Wallet
              </Label>
              <Select 
                value={donationWallet || "none"} 
                onValueChange={(val) => setDonationWallet(val === "none" ? "" : val)}
              >
                <SelectTrigger>
                  <SelectValue placeholder={walletsLoading ? "Loading wallets..." : "Select wallet"} />
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
          {uploading ? 'Uploading...' : publishing ? 'Publishing...' : 'Publish Event'}
        </Button>
      </form>
    </div>
  );
}
