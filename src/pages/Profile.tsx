import { useEffect, useState } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import * as z from "zod";
import { User, Save, Loader2, Navigation, Map, Plus, Upload, X, Eye, EyeOff, Copy, Globe, Link, Building2 } from "lucide-react";
import { useAuth } from "@/contexts/AuthContext";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Form, FormControl, FormDescription, FormField, FormItem, FormLabel, FormMessage } from "@/components/ui/form";
import { useToast } from "@/hooks/use-toast";
import { useNostrProfile } from "@/hooks/useNostrProfile";
import { useLanguages } from "@/hooks/useLanguages";
import { Separator } from "@/components/ui/separator";
import LocationPicker from "@/components/LocationPicker";
import { PaymentMethodCard } from "@/components/profile/PaymentMethodCard";
import { PaymentMethodDialog } from "@/components/profile/PaymentMethodDialog";
import { PaymentMethod } from "@/types/paymentMethods";
import { getProxiedImageUrl } from "@/lib/imageProxy";

const profileSchema = z.object({
  // Required fields
  name: z.string().min(1, "Name is required"),
  display_name: z.string().min(1, "Display name is required"),
  about: z.string().min(1, "About is required"),
  location: z.string().min(1, "Location is required"),
  country: z.string().min(2, "Country code is required").max(2),
  currency: z.string().min(1, "Currency is required"),
  lanoshi2lash: z.string().min(1, "Exchange rate is required"),
  whoAreYou: z.enum(["Human", "EI"], { required_error: "Please select who you are" }),
  orgasmic_profile: z.string().min(1, "Orgasmic profile is required"),
  lang: z.string().min(1, "Language is required"),
  interests: z.string().min(1, "At least one interest is required"),
  intimateInterests: z.string().min(1, "At least one intimate interest is required"),
  statement_of_responsibility: z.string()
    .min(10, "Statement must be at least 10 characters"),
  
  // Optional fields
  picture: z.string().url().optional().or(z.literal("")),
  website: z.string().url().optional().or(z.literal("")),
  nip05: z.string().optional(),
  payment_link: z.string().url().optional().or(z.literal("")),
  lanaWalletID: z.string().optional(),
  latitude: z.number().min(-90).max(90).optional(),
  longitude: z.number().min(-180).max(180).optional(),
  bankName: z.string().optional(),
  bankAddress: z.string().optional(),
  bankSWIFT: z.string().optional(),
  bankAccount: z.string().optional(),
});

type ProfileFormData = z.infer<typeof profileSchema>;

export default function Profile() {
  const { toast } = useToast();
  const { session } = useAuth();
  const { profile, isLoading, isPublishing, publishProfile } = useNostrProfile();
  const { languages, isLoading: languagesLoading } = useLanguages();
  const [isEditing, setIsEditing] = useState(false);
  const [showPrivateKey, setShowPrivateKey] = useState(false);
  const [loadingLocation, setLoadingLocation] = useState(false);
  const [showLocationPicker, setShowLocationPicker] = useState(false);
  const [paymentMethods, setPaymentMethods] = useState<PaymentMethod[]>([]);
  const [showPaymentDialog, setShowPaymentDialog] = useState(false);
  const [editingPayment, setEditingPayment] = useState<PaymentMethod | null>(null);
  const [uploadingAvatar, setUploadingAvatar] = useState(false);
  const [avatarPreview, setAvatarPreview] = useState<string | null>(null);

  // Helper function to ensure avatar URL is in correct format
  const formatAvatarUrl = (url: string | undefined, nostrHexId: string): string => {
    if (!url) return '';

    // If it's already a lanaknows.us URL, return it as is
    if (url.includes('lanaknows.us')) return url;

    // If it's a Supabase URL, convert to lanaknows.us format
    if (url.includes('supabase.co')) {
      return `https://lanaknows.us/${nostrHexId}`;
    }

    // If it's a local server storage URL (relative or absolute), return as-is
    if (url.includes('/api/storage/')) return url;

    // If it's a localhost URL, strip localhost and make relative
    if (url.includes('localhost')) {
      try {
        const parsed = new URL(url);
        return parsed.pathname;
      } catch { return url; }
    }

    return url;
  };

  const form = useForm<ProfileFormData>({
    resolver: zodResolver(profileSchema),
    defaultValues: {
      name: "",
      display_name: "",
      about: "",
      location: "",
      country: "US",
      currency: "USD",
      lanoshi2lash: "300000000",
      whoAreYou: "Human",
      orgasmic_profile: "",
      lang: "en",
      interests: "",
      intimateInterests: "",
      statement_of_responsibility: "",
      picture: "",
      website: "",
      nip05: "",
      payment_link: "",
      lanaWalletID: "",
      latitude: undefined,
      longitude: undefined,
      bankName: "",
      bankAddress: "",
      bankSWIFT: "",
      bankAccount: "",
    },
  });

  // Load profile data into form
  useEffect(() => {
    if (profile && session?.nostrHexId) {
      const formattedPictureUrl = formatAvatarUrl(profile.picture, session.nostrHexId);
      
      form.reset({
        name: profile.name || '',
        display_name: profile.display_name || '',
        about: profile.about || '',
        picture: formattedPictureUrl,
        location: profile.location || '',
        country: profile.country || '',
        currency: profile.currency || '',
        lang: profile.lang || profile.language || '',
        latitude: profile.latitude || 0,
        longitude: profile.longitude || 0,
        interests: profile.interests?.join(', ') || '',
        intimateInterests: profile.intimateInterests?.join(', ') || '',
        statement_of_responsibility: profile.statement_of_responsibility || '',
        lanoshi2lash: profile.lanoshi2lash || '',
        lanaWalletID: profile.lanaWalletID || session?.walletId || '',
        whoAreYou: profile.whoAreYou as "Human" | "EI" || 'Human',
        orgasmic_profile: profile.orgasmic_profile || '',
        website: profile.website || '',
        nip05: profile.nip05 || '',
        payment_link: profile.payment_link || '',
        bankName: profile.bankName || '',
        bankAddress: profile.bankAddress || '',
        bankSWIFT: profile.bankSWIFT || '',
        bankAccount: profile.bankAccount || '',
      });

      const paymentMethodsData = profile.payment_methods;
      if (paymentMethodsData && Array.isArray(paymentMethodsData)) {
        setPaymentMethods(paymentMethodsData as PaymentMethod[]);
      }
    }
  }, [profile, form]);


  const onSubmit = async (data: ProfileFormData) => {
    const profileData = {
      ...data,
      interests: data.interests.split(",").map(s => s.trim()).filter(Boolean),
      intimateInterests: data.intimateInterests.split(",").map(s => s.trim()).filter(Boolean),
      payment_methods: paymentMethods.length > 0 ? paymentMethods : undefined,
    };

    const result = await publishProfile(profileData);

    if (result.success) {
      // Update nostr_profiles cache table
      if (session?.nostrHexId) {
        await supabase.from('nostr_profiles').upsert([{
          nostr_hex_id: session.nostrHexId,
          full_name: data.name,
          display_name: data.display_name,
          picture: data.picture || null,
          about: data.about,
          lana_wallet_id: data.lanaWalletID || null,
          raw_metadata: JSON.parse(JSON.stringify(profileData)),
          last_fetched_at: new Date().toISOString(),
          updated_at: new Date().toISOString(),
        }], { onConflict: 'nostr_hex_id' });
      }

      toast({
        title: "Profile updated",
        description: "Your profile has been published to Nostr relays",
      });
      setIsEditing(false);
    } else {
      toast({
        title: "Error",
        description: result.error || "Failed to publish profile",
        variant: "destructive",
      });
    }
  };

  const handleSavePaymentMethod = (method: PaymentMethod) => {
    setPaymentMethods(prev => {
      const existing = prev.find(m => m.id === method.id);
      if (existing) {
        return prev.map(m => m.id === method.id ? method : m);
      }
      return [...prev, method];
    });
    setEditingPayment(null);
  };

  const handleDeletePaymentMethod = (id: string) => {
    setPaymentMethods(prev => prev.filter(m => m.id !== id));
  };

  const handleSetPrimaryPaymentMethod = (id: string) => {
    setPaymentMethods(prev => prev.map(m => ({
      ...m,
      primary: m.id === id
    })));
  };

  const handleAddPaymentMethod = () => {
    setEditingPayment(null);
    setShowPaymentDialog(true);
  };

  const handleEditPaymentMethod = (method: PaymentMethod) => {
    setEditingPayment(method);
    setShowPaymentDialog(true);
  };

  const handleGetCurrentLocation = () => {
    if (!navigator.geolocation) {
      toast({
        title: "Geolocation not supported",
        description: "Your browser doesn't support geolocation",
        variant: "destructive",
      });
      return;
    }

    setLoadingLocation(true);
    navigator.geolocation.getCurrentPosition(
      (position) => {
        const lat = Math.round(position.coords.latitude * 1000000) / 1000000;
        const lng = Math.round(position.coords.longitude * 1000000) / 1000000;
        
        form.setValue('latitude', lat);
        form.setValue('longitude', lng);
        
        toast({
          title: "Location detected",
          description: `Coordinates: ${lat}, ${lng}`,
        });
        
        setLoadingLocation(false);
      },
      (error) => {
        console.error('Geolocation error:', error);
        let errorMessage = "Failed to get your location";
        switch(error.code) {
          case error.PERMISSION_DENIED:
            errorMessage = "Location permission denied. Please enable location access in your browser.";
            break;
          case error.POSITION_UNAVAILABLE:
            errorMessage = "Location information unavailable";
            break;
          case error.TIMEOUT:
            errorMessage = "Location request timed out";
            break;
        }
        
        toast({
          title: "Unable to get location",
          description: errorMessage,
          variant: "destructive",
        });
        setLoadingLocation(false);
      },
      {
        enableHighAccuracy: true,
        timeout: 10000,
        maximumAge: 0,
      }
    );
  };

  const handleLocationSelect = (latitude: number, longitude: number) => {
    const lat = Math.round(latitude * 1000000) / 1000000;
    const lng = Math.round(longitude * 1000000) / 1000000;
    
    form.setValue('latitude', lat);
    form.setValue('longitude', lng);
    
    toast({
      title: "Location selected",
      description: `Coordinates: ${lat}, ${lng}`,
    });
  };

  const resizeImage = (file: File, maxSize: number): Promise<Blob> => {
    return new Promise((resolve, reject) => {
      const img = new Image();
      const url = URL.createObjectURL(file);
      img.onload = () => {
        URL.revokeObjectURL(url);
        const canvas = document.createElement('canvas');
        let { width, height } = img;
        // Scale down to fit within maxSize x maxSize square
        if (width > maxSize || height > maxSize) {
          if (width > height) {
            height = Math.round((height * maxSize) / width);
            width = maxSize;
          } else {
            width = Math.round((width * maxSize) / height);
            height = maxSize;
          }
        }
        canvas.width = width;
        canvas.height = height;
        const ctx = canvas.getContext('2d');
        if (!ctx) return reject(new Error('Canvas context failed'));
        ctx.drawImage(img, 0, 0, width, height);
        canvas.toBlob(
          (blob) => blob ? resolve(blob) : reject(new Error('Blob creation failed')),
          'image/jpeg',
          0.85
        );
      };
      img.onerror = () => reject(new Error('Image load failed'));
      img.src = url;
    });
  };

  const handleAvatarUpload = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) return;

    // Check file size (max 5MB)
    if (file.size > 5 * 1024 * 1024) {
      toast({
        title: "File too large",
        description: "Please select an image smaller than 5MB",
        variant: "destructive",
      });
      return;
    }

    // Check file type
    const allowedTypes = ['image/jpeg', 'image/png', 'image/gif', 'image/webp'];
    if (!allowedTypes.includes(file.type)) {
      toast({
        title: "Invalid file type",
        description: "Please select a JPG, PNG, GIF, or WEBP image",
        variant: "destructive",
      });
      return;
    }

    // Show preview
    const reader = new FileReader();
    reader.onload = (e) => {
      setAvatarPreview(e.target?.result as string);
    };
    reader.readAsDataURL(file);

    setUploadingAvatar(true);

    try {
      // Resize to 256x256 max for avatar
      const resizedBlob = await resizeImage(file, 256);

      const formData = new FormData();
      formData.append('path', `${session.nostrHexId}/avatar.jpg`);
      formData.append('file', resizedBlob, 'avatar.jpg');

      const response = await fetch('/api/storage/profile-avatars/upload', {
        method: 'POST',
        body: formData,
      });

      const result = await response.json();

      if (result.data?.publicUrl) {
        // Convert relative URL to absolute so it works when published to Nostr
        const absoluteUrl = result.data.publicUrl.startsWith('/')
          ? `${window.location.origin}${result.data.publicUrl}`
          : result.data.publicUrl;
        form.setValue('picture', absoluteUrl);
        toast({
          title: "Avatar uploaded",
          description: "Your avatar has been uploaded successfully",
        });
      } else if (result.error) {
        throw new Error(result.error);
      } else {
        throw new Error('Upload failed');
      }
    } catch (error) {
      console.error('Avatar upload error:', error);
      toast({
        title: "Upload failed",
        description: error instanceof Error ? error.message : "Failed to upload avatar",
        variant: "destructive",
      });
      setAvatarPreview(null);
    } finally {
      setUploadingAvatar(false);
    }
  };

  const handleRemoveAvatarPreview = () => {
    setAvatarPreview(null);
    form.setValue('picture', '');
  };

  if (isLoading || languagesLoading) {
    return (
      <div className="flex items-center justify-center min-h-[400px]">
        <div className="text-center">
          <Loader2 className="h-8 w-8 animate-spin mx-auto mb-4 text-primary" />
          <p className="text-muted-foreground">Loading profile...</p>
        </div>
      </div>
    );
  }

  return (
    <div className="max-w-4xl mx-auto p-6">
      <div className="mb-6">
        <h1 className="text-3xl font-bold">Profile</h1>
        <p className="text-muted-foreground">Manage your Nostr profile (KIND 0)</p>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <User className="h-5 w-5" />
            {isEditing ? "Edit Profile" : "Your Profile"}
          </CardTitle>
          <CardDescription>
            {isEditing 
              ? "Update your information and publish to Nostr relays" 
              : "View your profile information"}
          </CardDescription>
        </CardHeader>
        <CardContent>
          {!isEditing && profile ? (
            <div className="space-y-6">
              <div className="flex items-center gap-4">
                {profile.picture ? (
                  <img 
                    src={getProxiedImageUrl(profile.picture, Date.now())} 
                    alt={profile.display_name} 
                    className="h-20 w-20 rounded-full object-cover flex-shrink-0"
                  />
                ) : (
                  <div className="h-20 w-20 rounded-full bg-gradient-to-br from-primary to-accent flex items-center justify-center flex-shrink-0">
                    <User className="h-10 w-10 text-primary-foreground" />
                  </div>
                )}
                <div className="min-w-0 flex-1">
                  <h2 className="text-2xl font-bold break-words">{profile.display_name || profile.name}</h2>
                  <p className="text-muted-foreground break-all">@{profile.name}</p>
                  {profile.nip05 && <p className="text-sm text-muted-foreground break-all">✓ {profile.nip05}</p>}
                  {profile.website && (
                    <a href={profile.website} target="_blank" rel="noopener noreferrer" className="text-sm text-primary hover:underline flex items-center gap-1 mt-1">
                      <Globe className="h-3 w-3" />
                      {profile.website}
                    </a>
                  )}
                </div>
              </div>

              {session?.nostrHexId && (
                <div className="bg-muted/50 rounded-lg p-3">
                  <Label className="text-muted-foreground text-xs">Nostr HEX ID</Label>
                  <div className="flex items-center gap-2">
                    <p className="font-mono text-xs break-all select-all flex-1">{session.nostrHexId}</p>
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => {
                        navigator.clipboard.writeText(session.nostrHexId);
                        toast({ title: "Copied", description: "Nostr HEX ID copied to clipboard" });
                      }}
                    >
                      <Copy className="h-4 w-4" />
                    </Button>
                  </div>
                </div>
              )}

              {session?.nostrPrivateKey && (
                <div className="bg-muted/50 rounded-lg p-3">
                  <Label className="text-muted-foreground text-xs">Nostr Private Key</Label>
                  <div className="flex items-center gap-2">
                    <p className="font-mono text-xs break-all select-all flex-1">
                      {showPrivateKey
                        ? (typeof session.nostrPrivateKey === 'string'
                            ? session.nostrPrivateKey
                            : Array.from(session.nostrPrivateKey as Uint8Array).map(b => b.toString(16).padStart(2, '0')).join(''))
                        : '••••••••••••••••••••••••••••••••••••••••••••••••••••••••••••••••'}
                    </p>
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => setShowPrivateKey(!showPrivateKey)}
                    >
                      {showPrivateKey ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                    </Button>
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => {
                        const key = typeof session.nostrPrivateKey === 'string'
                          ? session.nostrPrivateKey
                          : Array.from(session.nostrPrivateKey as Uint8Array).map(b => b.toString(16).padStart(2, '0')).join('');
                        navigator.clipboard.writeText(key);
                        toast({ title: "Copied", description: "Nostr Private Key copied to clipboard" });
                      }}
                    >
                      <Copy className="h-4 w-4" />
                    </Button>
                  </div>
                  <p className="text-xs text-destructive mt-1">⚠️ Never share your private key!</p>
                </div>
              )}

              {(profile.lanaWalletID || session?.walletId) && (
                <div className="bg-muted/50 rounded-lg p-3">
                  <Label className="text-muted-foreground text-xs">
                    Lana Wallet ID
                    {!profile.lanaWalletID && session?.walletId && (
                      <Badge variant="secondary" className="ml-2 text-[10px] px-1.5 py-0">from session</Badge>
                    )}
                  </Label>
                  <div className="flex items-center gap-2">
                    <p className="font-mono text-xs break-all select-all flex-1">
                      {profile.lanaWalletID || session?.walletId}
                    </p>
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => {
                        const walletId = profile.lanaWalletID || session?.walletId || '';
                        navigator.clipboard.writeText(walletId);
                        toast({ title: "Copied", description: "Lana Wallet ID copied to clipboard" });
                      }}
                    >
                      <Copy className="h-4 w-4" />
                    </Button>
                  </div>
                </div>
              )}

              <Separator />

              <div className="grid gap-6 md:grid-cols-2">
                <div>
                  <Label className="text-muted-foreground">About</Label>
                  <p className="break-words">{profile.about}</p>
                </div>
                <div>
                  <Label className="text-muted-foreground">Location</Label>
                  <p className="break-words">{profile.location} ({profile.country})</p>
                  {profile.latitude && profile.longitude && (
                    <p className="text-sm text-muted-foreground mt-1 break-all">
                      Coordinates: {profile.latitude.toFixed(6)}, {profile.longitude.toFixed(6)}
                    </p>
                  )}
                </div>
                <div>
                  <Label className="text-muted-foreground">Language</Label>
                  <p>{languages.find(l => l.code === profile.lang)?.nativeName || profile.lang}</p>
                </div>
                <div>
                  <Label className="text-muted-foreground">Currency</Label>
                  <p>{profile.currency}</p>
                </div>
                <div>
                  <Label className="text-muted-foreground">Who Are You</Label>
                  <p>{profile.whoAreYou}</p>
                </div>
                <div>
                  <Label className="text-muted-foreground">Exchange Rate</Label>
                  <p>{profile.lanoshi2lash}</p>
                </div>
                {profile.payment_link && (
                  <div>
                    <Label className="text-muted-foreground">Payment Link</Label>
                    <a href={profile.payment_link} target="_blank" rel="noopener noreferrer" className="text-sm text-primary hover:underline flex items-center gap-1">
                      <Link className="h-3 w-3" />
                      {profile.payment_link}
                    </a>
                  </div>
                )}
                {profile.interests && profile.interests.length > 0 && (
                  <div className="md:col-span-2">
                    <Label className="text-muted-foreground">Interests</Label>
                    <p className="break-words">{profile.interests.join(", ")}</p>
                  </div>
                )}
                {profile.intimateInterests && profile.intimateInterests.length > 0 && (
                  <div className="md:col-span-2">
                    <Label className="text-muted-foreground">Intimate Interests</Label>
                    <p className="break-words">{profile.intimateInterests.join(", ")}</p>
                  </div>
                )}
                <div className="md:col-span-2">
                  <Label className="text-muted-foreground">Orgasmic Profile</Label>
                  <p className="break-words">{profile.orgasmic_profile}</p>
                </div>
                {profile.statement_of_responsibility && (
                  <div className="md:col-span-2">
                    <Label className="text-muted-foreground">Statement of Self-Responsibility</Label>
                    <p className="break-words">{profile.statement_of_responsibility}</p>
                  </div>
                )}
              </div>

              {profile.payment_methods && profile.payment_methods.length > 0 && (
                <>
                  <Separator />
                  <div className="space-y-4">
                    <h3 className="text-lg font-semibold">Payment Methods</h3>
                    <div className="space-y-3">
                      {profile.payment_methods.map((method: any) => (
                        <Card key={method.id} className="p-4">
                          <div className="space-y-2">
                            <div className="flex items-center justify-between">
                              <h4 className="font-semibold">{method.label}</h4>
                              {method.primary && (
                                <span className="text-xs bg-primary text-primary-foreground px-2 py-1 rounded">
                                  Primary
                                </span>
                              )}
                            </div>
                            <div className="text-sm text-muted-foreground">
                              {method.scheme} • {method.country} • {method.currency} • {method.scope}
                            </div>
                          </div>
                        </Card>
                      ))}
                    </div>
                  </div>
                </>
              )}

              {(profile.bankName || profile.bankAccount) && (
                <>
                  <Separator />
                  <div className="space-y-4">
                    <div className="flex items-center gap-2">
                      <Building2 className="h-5 w-5 text-muted-foreground" />
                      <h3 className="text-lg font-semibold">Legacy Banking Information</h3>
                    </div>
                    <div className="grid gap-4 md:grid-cols-2">
                      {profile.bankName && (
                        <div>
                          <Label className="text-muted-foreground">Bank Name</Label>
                          <p>{profile.bankName}</p>
                        </div>
                      )}
                      {profile.bankSWIFT && (
                        <div>
                          <Label className="text-muted-foreground">SWIFT/BIC Code</Label>
                          <p className="font-mono">{profile.bankSWIFT}</p>
                        </div>
                      )}
                      {profile.bankAddress && (
                        <div>
                          <Label className="text-muted-foreground">Bank Address</Label>
                          <p>{profile.bankAddress}</p>
                        </div>
                      )}
                      {profile.bankAccount && (
                        <div>
                          <Label className="text-muted-foreground">Bank Account Number</Label>
                          <p className="font-mono">{profile.bankAccount}</p>
                        </div>
                      )}
                    </div>
                  </div>
                </>
              )}

              <Button onClick={() => setIsEditing(true)} className="w-full md:w-auto">
                Edit Profile
              </Button>
            </div>
          ) : (
            <Form {...form}>
              <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-6">
                <div className="space-y-4">
                  <h3 className="text-lg font-semibold">Basic Information</h3>
                  
                  <div className="grid gap-4 md:grid-cols-2">
                    <FormField
                      control={form.control}
                      name="name"
                      render={({ field }) => (
                        <FormItem>
                          <FormLabel>Username *</FormLabel>
                          <FormControl>
                            <Input placeholder="john_doe" {...field} />
                          </FormControl>
                          <FormMessage />
                        </FormItem>
                      )}
                    />

                    <FormField
                      control={form.control}
                      name="display_name"
                      render={({ field }) => (
                        <FormItem>
                          <FormLabel>Display Name *</FormLabel>
                          <FormControl>
                            <Input placeholder="John Doe" {...field} />
                          </FormControl>
                          <FormMessage />
                        </FormItem>
                      )}
                    />
                  </div>

                  <FormField
                    control={form.control}
                    name="about"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel>About *</FormLabel>
                        <FormControl>
                          <Textarea placeholder="Tell us about yourself" {...field} />
                        </FormControl>
                        <FormMessage />
                      </FormItem>
                    )}
                  />

                  <div className="space-y-4">
                    <FormField
                      control={form.control}
                      name="picture"
                      render={({ field }) => (
                        <FormItem>
                          <FormLabel>Avatar</FormLabel>
                          <div className="space-y-4">
                            {/* Avatar Preview */}
                            <div className="flex items-center gap-4">
                              {(avatarPreview || field.value) && (
                                <div className="relative">
                                  <img 
                                    src={avatarPreview || getProxiedImageUrl(field.value, Date.now()) || field.value} 
                                    alt="Avatar preview" 
                                    className="h-20 w-20 rounded-full object-cover"
                                  />
                                  {!uploadingAvatar && (
                                    <button
                                      type="button"
                                      onClick={handleRemoveAvatarPreview}
                                      className="absolute -top-2 -right-2 h-6 w-6 rounded-full bg-destructive text-destructive-foreground flex items-center justify-center hover:bg-destructive/90"
                                    >
                                      <X className="h-4 w-4" />
                                    </button>
                                  )}
                                </div>
                              )}
                              {uploadingAvatar && (
                                <Loader2 className="h-8 w-8 animate-spin text-primary" />
                              )}
                            </div>

                            {/* Upload Button */}
                            <div>
                              <input
                                type="file"
                                id="avatar-upload"
                                accept="image/jpeg,image/png,image/gif,image/webp"
                                onChange={handleAvatarUpload}
                                disabled={uploadingAvatar}
                                className="hidden"
                              />
                              <label htmlFor="avatar-upload">
                                <Button
                                  type="button"
                                  variant="outline"
                                  disabled={uploadingAvatar}
                                  onClick={() => document.getElementById('avatar-upload')?.click()}
                                  className="w-full md:w-auto"
                                >
                                  <Upload className="h-4 w-4 mr-2" />
                                  {uploadingAvatar ? "Uploading..." : "Upload Avatar"}
                                </Button>
                              </label>
                              <p className="text-xs text-muted-foreground mt-2">
                                Max 5MB • JPG, PNG, GIF, WEBP • Auto-resized to 256x256px
                              </p>
                            </div>

                            {/* Manual URL Input */}
                            <div>
                              <FormLabel className="text-sm">Or enter URL manually</FormLabel>
                              <FormControl>
                                <Input placeholder="https://example.com/avatar.jpg" {...field} />
                              </FormControl>
                            </div>
                          </div>
                          <FormMessage />
                        </FormItem>
                      )}
                    />
                  </div>

                  <div className="grid gap-4 md:grid-cols-2">

                    <FormField
                      control={form.control}
                      name="website"
                      render={({ field }) => (
                        <FormItem>
                          <FormLabel>Website</FormLabel>
                          <FormControl>
                            <Input placeholder="https://example.com" {...field} />
                          </FormControl>
                          <FormMessage />
                        </FormItem>
                      )}
                    />
                  </div>

                  <FormField
                    control={form.control}
                    name="nip05"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel>NIP-05 Verification</FormLabel>
                        <FormControl>
                          <Input placeholder="name@domain.com" {...field} />
                        </FormControl>
                        <FormMessage />
                      </FormItem>
                    )}
                  />
                </div>

                <Separator />

                <div className="space-y-4">
                  <h3 className="text-lg font-semibold">Location & Preferences</h3>
                  
                  <div className="grid gap-4 md:grid-cols-2">
                    <FormField
                      control={form.control}
                      name="location"
                      render={({ field }) => (
                        <FormItem>
                          <FormLabel>Location *</FormLabel>
                          <FormControl>
                            <Input placeholder="New York, USA" {...field} />
                          </FormControl>
                          <FormMessage />
                        </FormItem>
                      )}
                    />

                    <FormField
                      control={form.control}
                      name="country"
                      render={({ field }) => (
                        <FormItem>
                          <FormLabel>Country Code *</FormLabel>
                          <FormControl>
                            <Input placeholder="US" maxLength={2} {...field} />
                          </FormControl>
                          <FormDescription>2-letter ISO code</FormDescription>
                          <FormMessage />
                        </FormItem>
                      )}
                    />

                    <FormField
                      control={form.control}
                      name="lang"
                      render={({ field }) => (
                        <FormItem>
                          <FormLabel>Language *</FormLabel>
                          <Select onValueChange={field.onChange} value={field.value}>
                            <FormControl>
                              <SelectTrigger>
                                <SelectValue placeholder="Select language" />
                              </SelectTrigger>
                            </FormControl>
                            <SelectContent>
                              {languages.map((lang) => (
                                <SelectItem key={lang.code} value={lang.code}>
                                  {lang.nativeName} ({lang.name})
                                </SelectItem>
                              ))}
                            </SelectContent>
                          </Select>
                          <FormMessage />
                        </FormItem>
                      )}
                    />

                    <FormField
                      control={form.control}
                      name="currency"
                      render={({ field }) => (
                        <FormItem>
                          <FormLabel>Currency *</FormLabel>
                          <Select onValueChange={field.onChange} value={field.value}>
                            <FormControl>
                              <SelectTrigger>
                                <SelectValue placeholder="Select currency" />
                              </SelectTrigger>
                            </FormControl>
                            <SelectContent>
                              <SelectItem value="EUR">EUR</SelectItem>
                              <SelectItem value="USD">USD</SelectItem>
                              <SelectItem value="GBP">GBP</SelectItem>
                            </SelectContent>
                          </Select>
                          <FormMessage />
                        </FormItem>
                      )}
                    />
                  </div>

                  <div className="space-y-4">
                    <Label>Geographic Coordinates (Optional)</Label>
                    <p className="text-sm text-muted-foreground mb-2">
                      Set your precise location for geolocation-based features.
                    </p>
                    
                    <div className="grid grid-cols-2 gap-2">
                      <Button
                        type="button"
                        variant="outline"
                        size="sm"
                        onClick={handleGetCurrentLocation}
                        disabled={loadingLocation}
                      >
                        {loadingLocation ? (
                          <>
                            <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                            Getting...
                          </>
                        ) : (
                          <>
                            <Navigation className="mr-2 h-4 w-4" />
                            Auto Detect
                          </>
                        )}
                      </Button>
                      
                      <Button
                        type="button"
                        variant="outline"
                        size="sm"
                        onClick={() => setShowLocationPicker(true)}
                      >
                        <Map className="mr-2 h-4 w-4" />
                        Select on Map
                      </Button>
                    </div>

                    {form.watch('latitude') && form.watch('longitude') && (
                      <p className="text-xs text-muted-foreground text-center">
                        📍 {form.watch('latitude')?.toFixed(6)}, {form.watch('longitude')?.toFixed(6)}
                      </p>
                    )}
                  </div>
                </div>

                <Separator />

                <div className="space-y-4">
                  <h3 className="text-lg font-semibold">LanaCoins Information</h3>
                  
                  <div className="grid gap-4 md:grid-cols-2">
                    <FormField
                      control={form.control}
                      name="whoAreYou"
                      render={({ field }) => (
                        <FormItem>
                          <FormLabel>Who Are You *</FormLabel>
                          <Select onValueChange={field.onChange} value={field.value}>
                            <FormControl>
                              <SelectTrigger>
                                <SelectValue placeholder="Select" />
                              </SelectTrigger>
                            </FormControl>
                            <SelectContent>
                              <SelectItem value="Human">Human</SelectItem>
                              <SelectItem value="EI">EI (Enlightened Intelligence)</SelectItem>
                            </SelectContent>
                          </Select>
                          <FormMessage />
                        </FormItem>
                      )}
                    />

                    <FormField
                      control={form.control}
                      name="lanoshi2lash"
                      render={({ field }) => (
                        <FormItem>
                          <FormLabel>Exchange Rate (lanoshi2lash) *</FormLabel>
                          <FormControl>
                            <Input placeholder="300000000" {...field} />
                          </FormControl>
                          <FormDescription>LanaCoins × 100,000,000</FormDescription>
                          <FormMessage />
                        </FormItem>
                      )}
                    />

                    <FormField
                      control={form.control}
                      name="lanaWalletID"
                      render={({ field }) => (
                        <FormItem>
                          <FormLabel>Lana Wallet ID</FormLabel>
                          <FormControl>
                            <Input placeholder="Your wallet ID" {...field} readOnly className="bg-muted" />
                          </FormControl>
                          <FormDescription>This field is read-only</FormDescription>
                          <FormMessage />
                        </FormItem>
                      )}
                    />

                    <FormField
                      control={form.control}
                      name="payment_link"
                      render={({ field }) => (
                        <FormItem>
                          <FormLabel>Payment Link</FormLabel>
                          <FormControl>
                            <Input placeholder="https://..." {...field} />
                          </FormControl>
                          <FormMessage />
                        </FormItem>
                      )}
                    />
                  </div>

                  <FormField
                    control={form.control}
                    name="orgasmic_profile"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel>Orgasmic Profile *</FormLabel>
                        <FormControl>
                          <Textarea 
                            placeholder="Describe your orgasmic profile and preferences" 
                            {...field} 
                          />
                        </FormControl>
                        <FormMessage />
                      </FormItem>
                    )}
                  />

                  <FormField
                    control={form.control}
                    name="statement_of_responsibility"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel>Statement of Self-Responsibility *</FormLabel>
                        <FormControl>
                          <Textarea 
                            placeholder="Write in your own words that you accept unconditional self-responsibility inside the Lana World..."
                            className="min-h-[100px]"
                            {...field} 
                          />
                        </FormControl>
                        <FormDescription>
                          You must explicitly accept unconditional self-responsibility before saving your profile. Minimum 10 characters.
                        </FormDescription>
                        <FormMessage />
                      </FormItem>
                    )}
                  />

                  <FormField
                    control={form.control}
                    name="interests"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel>Interests (t tags) *</FormLabel>
                        <FormControl>
                          <Input 
                            placeholder="bitcoin, nostr, decentralization (comma-separated)" 
                            {...field} 
                          />
                        </FormControl>
                        <FormDescription>Things you are interested in</FormDescription>
                        <FormMessage />
                      </FormItem>
                    )}
                  />

                  <FormField
                    control={form.control}
                    name="intimateInterests"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel>Intimate Interests (o tags) *</FormLabel>
                        <FormControl>
                          <Input 
                            placeholder="deep_connection, meaningful_intimacy (comma-separated)" 
                            {...field} 
                          />
                        </FormControl>
                        <FormDescription>Intimate perspective interests</FormDescription>
                        <FormMessage />
                      </FormItem>
                    )}
                  />
                </div>

                <Separator />

                <div className="space-y-4">
                  <div className="flex items-center justify-between">
                    <div>
                      <h3 className="text-lg font-semibold">Payment Methods</h3>
                      <p className="text-sm text-muted-foreground">
                        Manage your payment collection and payout methods
                      </p>
                    </div>
                    <Button
                      type="button"
                      variant="outline"
                      onClick={handleAddPaymentMethod}
                    >
                      <Plus className="mr-2 h-4 w-4" />
                      Add Method
                    </Button>
                  </div>

                  {paymentMethods.length > 0 ? (
                    <div className="space-y-4">
                      {paymentMethods.map(method => (
                        <PaymentMethodCard
                          key={method.id}
                          method={method}
                          onEdit={handleEditPaymentMethod}
                          onDelete={handleDeletePaymentMethod}
                          onSetPrimary={handleSetPrimaryPaymentMethod}
                        />
                      ))}
                    </div>
                  ) : (
                    <Card className="p-6 text-center border-dashed">
                      <p className="text-muted-foreground">
                        No payment methods added yet. Click "Add Method" to get started.
                      </p>
                    </Card>
                  )}

                  {(form.watch('bankName') || form.watch('bankAccount')) && (
                    <div className="mt-4 p-4 bg-muted rounded-lg">
                      <h4 className="font-semibold mb-2 text-sm">Legacy Banking Information</h4>
                      <p className="text-sm text-muted-foreground mb-3">
                        You have legacy banking fields. Consider migrating to the new payment methods format.
                      </p>
                      <div className="grid gap-4 md:grid-cols-2">
                        <FormField
                          control={form.control}
                          name="bankName"
                          render={({ field }) => (
                            <FormItem>
                              <FormLabel>Bank Name</FormLabel>
                              <FormControl>
                                <Input placeholder="Example Bank" {...field} />
                              </FormControl>
                              <FormMessage />
                            </FormItem>
                          )}
                        />

                        <FormField
                          control={form.control}
                          name="bankSWIFT"
                          render={({ field }) => (
                            <FormItem>
                              <FormLabel>SWIFT/BIC Code</FormLabel>
                              <FormControl>
                                <Input placeholder="EXAMPLEUS33" {...field} />
                              </FormControl>
                              <FormMessage />
                            </FormItem>
                          )}
                        />

                        <FormField
                          control={form.control}
                          name="bankAddress"
                          render={({ field }) => (
                            <FormItem>
                              <FormLabel>Bank Address</FormLabel>
                              <FormControl>
                                <Input placeholder="123 Banking St" {...field} />
                              </FormControl>
                              <FormMessage />
                            </FormItem>
                          )}
                        />

                        <FormField
                          control={form.control}
                          name="bankAccount"
                          render={({ field }) => (
                            <FormItem>
                              <FormLabel>Bank Account Number</FormLabel>
                              <FormControl>
                                <Input placeholder="1234567890" {...field} />
                              </FormControl>
                              <FormMessage />
                            </FormItem>
                          )}
                        />
                      </div>
                    </div>
                  )}
                </div>

                <div className="flex gap-2 pt-4">
                  <Button type="submit" disabled={isPublishing}>
                    {isPublishing ? (
                      <>
                        <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                        Publishing...
                      </>
                    ) : (
                      <>
                        <Save className="mr-2 h-4 w-4" />
                        Save & Publish
                      </>
                    )}
                  </Button>
                  {isEditing && (
                    <Button 
                      type="button" 
                      variant="outline" 
                      onClick={() => setIsEditing(false)}
                    >
                      Cancel
                    </Button>
                  )}
                </div>
              </form>
            </Form>
          )}
        </CardContent>
        
        {/* LocationPicker Modal */}
        {showLocationPicker && (
          <LocationPicker
            onLocationSelect={handleLocationSelect}
            onClose={() => setShowLocationPicker(false)}
            initialLat={form.watch('latitude')}
            initialLng={form.watch('longitude')}
          />
        )}
      </Card>

      {/* Payment Method Dialog */}
      <PaymentMethodDialog
        open={showPaymentDialog}
        onOpenChange={setShowPaymentDialog}
        onSave={handleSavePaymentMethod}
        editingMethod={editingPayment}
      />
    </div>
  );
}
