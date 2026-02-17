import { useState, useEffect, useCallback } from "react";
import { useParams, useNavigate } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { useLanguages } from "@/hooks/useLanguages";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Separator } from "@/components/ui/separator";
import { UserAvatar } from "@/components/ui/UserAvatar";
import { ArrowLeft, Copy, Globe, Link, Building2, Calendar } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { format } from "date-fns";
import { sl } from "date-fns/locale";

interface ProfileData {
  pubkey: string;
  name?: string;
  display_name?: string;
  about?: string;
  picture?: string;
  website?: string;
  nip05?: string;
  payment_link?: string;
  location?: string;
  country?: string;
  currency?: string;
  latitude?: number;
  longitude?: number;
  lanoshi2lash?: string;
  lanaWalletID?: string;
  whoAreYou?: string;
  orgasmic_profile?: string;
  statement_of_responsibility?: string;
  payment_methods?: any[];
  bankName?: string;
  bankAddress?: string;
  bankSWIFT?: string;
  bankAccount?: string;
  interests?: string[];
  intimateInterests?: string[];
  lang?: string;
  created_at?: number;
}

export default function ProfileDetail() {
  const { pubkey } = useParams<{ pubkey: string }>();
  const navigate = useNavigate();
  const { toast } = useToast();
  const { languages } = useLanguages();
  const [profile, setProfile] = useState<ProfileData | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const fetchProfile = useCallback(async () => {
    if (!pubkey) return;
    setIsLoading(true);
    setError(null);

    try {
      // 1. Query DB for cached profile with raw_metadata
      const { data, error: dbError } = await supabase
        .from("nostr_profiles")
        .select("*")
        .eq("nostr_hex_id", pubkey)
        .single();

      if (data) {
        const raw = (data.raw_metadata as Record<string, any>) || {};
        setProfile({
          pubkey: data.nostr_hex_id,
          name: data.full_name || raw.name,
          display_name: data.display_name || raw.display_name,
          about: data.about || raw.about,
          picture: data.picture || raw.picture,
          website: raw.website,
          nip05: raw.nip05,
          payment_link: raw.payment_link,
          location: raw.location,
          country: raw.country,
          currency: raw.currency,
          latitude: raw.latitude,
          longitude: raw.longitude,
          lanoshi2lash: raw.lanoshi2lash,
          lanaWalletID: data.lana_wallet_id || raw.lanaWalletID,
          whoAreYou: raw.whoAreYou,
          orgasmic_profile: raw.orgasmic_profile,
          statement_of_responsibility: raw.statement_of_responsibility,
          payment_methods: raw.payment_methods,
          bankName: raw.bankName,
          bankAddress: raw.bankAddress,
          bankSWIFT: raw.bankSWIFT,
          bankAccount: raw.bankAccount,
          interests: raw.interests,
          intimateInterests: raw.intimateInterests,
          lang: raw.lang,
          created_at: data.created_at ? Math.floor(new Date(data.created_at).getTime() / 1000) : undefined,
        });
        setIsLoading(false);

        // Background refresh if stale (>24h)
        const lastFetched = new Date(data.last_fetched_at).getTime();
        if (Date.now() - lastFetched > 24 * 60 * 60 * 1000) {
          supabase.functions.invoke("refresh-nostr-profiles", {
            body: { pubkeys: [pubkey] },
          });
        }
        return;
      }

      // 2. Not in DB — trigger server-side fetch
      if (dbError && dbError.code === "PGRST116") {
        await supabase.functions.invoke("refresh-nostr-profiles", {
          body: { pubkeys: [pubkey] },
        });
        // Wait then retry
        await new Promise((r) => setTimeout(r, 3000));
        const { data: retryData } = await supabase
          .from("nostr_profiles")
          .select("*")
          .eq("nostr_hex_id", pubkey)
          .single();

        if (retryData) {
          const raw = (retryData.raw_metadata as Record<string, any>) || {};
          setProfile({
            pubkey: retryData.nostr_hex_id,
            name: retryData.full_name || raw.name,
            display_name: retryData.display_name || raw.display_name,
            about: retryData.about || raw.about,
            picture: retryData.picture || raw.picture,
            website: raw.website,
            nip05: raw.nip05,
            payment_link: raw.payment_link,
            location: raw.location,
            country: raw.country,
            currency: raw.currency,
            latitude: raw.latitude,
            longitude: raw.longitude,
            lanoshi2lash: raw.lanoshi2lash,
            lanaWalletID: retryData.lana_wallet_id || raw.lanaWalletID,
            whoAreYou: raw.whoAreYou,
            orgasmic_profile: raw.orgasmic_profile,
            statement_of_responsibility: raw.statement_of_responsibility,
            payment_methods: raw.payment_methods,
            bankName: raw.bankName,
            bankAddress: raw.bankAddress,
            bankSWIFT: raw.bankSWIFT,
            bankAccount: raw.bankAccount,
            interests: raw.interests,
            intimateInterests: raw.intimateInterests,
            lang: raw.lang,
            created_at: retryData.created_at ? Math.floor(new Date(retryData.created_at).getTime() / 1000) : undefined,
          });
        } else {
          setError("Profile not found");
        }
      } else {
        setError("Failed to load profile");
      }
    } catch (err) {
      console.error("Error fetching profile:", err);
      setError("Failed to load profile");
    } finally {
      setIsLoading(false);
    }
  }, [pubkey]);

  useEffect(() => {
    fetchProfile();
  }, [fetchProfile]);

  const copyToClipboard = (text: string, label: string) => {
    navigator.clipboard.writeText(text);
    toast({ title: "Copied", description: `${label} copied to clipboard` });
  };

  if (isLoading) {
    return (
      <div className="container mx-auto p-6 max-w-4xl">
        <div className="text-center py-12">
          <p className="text-muted-foreground">Loading profile...</p>
        </div>
      </div>
    );
  }

  if (error || !profile) {
    return (
      <div className="container mx-auto p-6 max-w-4xl">
        <div className="text-center py-12 space-y-4">
          <p className="text-muted-foreground">{error || "Profile not found"}</p>
          <Button variant="outline" onClick={() => navigate("/transparency/profiles")}>
            <ArrowLeft className="mr-2 h-4 w-4" />
            Back to Profiles
          </Button>
        </div>
      </div>
    );
  }

  return (
    <div className="container mx-auto p-6 max-w-4xl">
      <Button
        variant="ghost"
        size="sm"
        onClick={() => navigate("/transparency/profiles")}
        className="mb-4"
      >
        <ArrowLeft className="mr-2 h-4 w-4" />
        Back to Profiles
      </Button>

      <Card>
        <CardHeader>
          <CardTitle>Profile</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="space-y-6">
            {/* Header: Avatar + Name */}
            <div className="flex items-center gap-4">
              <UserAvatar
                pubkey={profile.pubkey}
                picture={profile.picture}
                name={profile.display_name || profile.name || "Anonymous"}
                className="h-20 w-20 flex-shrink-0"
              />
              <div className="min-w-0 flex-1">
                <h2 className="text-2xl font-bold break-words">
                  {profile.display_name || profile.name || "Anonymous"}
                </h2>
                {profile.name && (
                  <p className="text-muted-foreground break-all">@{profile.name}</p>
                )}
                {profile.nip05 && (
                  <p className="text-sm text-muted-foreground break-all">✓ {profile.nip05}</p>
                )}
                {profile.website && (
                  <a
                    href={profile.website}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="text-sm text-primary hover:underline flex items-center gap-1 mt-1"
                  >
                    <Globe className="h-3 w-3" />
                    {profile.website}
                  </a>
                )}
              </div>
            </div>

            {/* Nostr HEX ID */}
            <div className="bg-muted/50 rounded-lg p-3">
              <Label className="text-muted-foreground text-xs">Nostr HEX ID</Label>
              <div className="flex items-center gap-2">
                <p className="font-mono text-xs break-all select-all flex-1">{profile.pubkey}</p>
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => copyToClipboard(profile.pubkey, "Nostr HEX ID")}
                >
                  <Copy className="h-4 w-4" />
                </Button>
              </div>
            </div>

            {/* Lana Wallet ID */}
            {profile.lanaWalletID && (
              <div className="bg-muted/50 rounded-lg p-3">
                <Label className="text-muted-foreground text-xs">Lana Wallet ID</Label>
                <div className="flex items-center gap-2">
                  <p className="font-mono text-xs break-all select-all flex-1">
                    {profile.lanaWalletID}
                  </p>
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => copyToClipboard(profile.lanaWalletID!, "Lana Wallet ID")}
                  >
                    <Copy className="h-4 w-4" />
                  </Button>
                </div>
              </div>
            )}

            <Separator />

            {/* Main Info Grid */}
            <div className="grid gap-6 md:grid-cols-2">
              {profile.about && (
                <div>
                  <Label className="text-muted-foreground">About</Label>
                  <p className="break-words">{profile.about}</p>
                </div>
              )}
              {profile.location && (
                <div>
                  <Label className="text-muted-foreground">Location</Label>
                  <p className="break-words">
                    {profile.location}
                    {profile.country && ` (${profile.country})`}
                  </p>
                  {profile.latitude && profile.longitude && (
                    <p className="text-sm text-muted-foreground mt-1 break-all">
                      Coordinates: {profile.latitude.toFixed(6)}, {profile.longitude.toFixed(6)}
                    </p>
                  )}
                </div>
              )}
              {profile.lang && (
                <div>
                  <Label className="text-muted-foreground">Language</Label>
                  <p>{languages.find((l) => l.code === profile.lang)?.nativeName || profile.lang}</p>
                </div>
              )}
              {profile.currency && (
                <div>
                  <Label className="text-muted-foreground">Currency</Label>
                  <p>{profile.currency}</p>
                </div>
              )}
              {profile.whoAreYou && (
                <div>
                  <Label className="text-muted-foreground">Who Are You</Label>
                  <p>{profile.whoAreYou}</p>
                </div>
              )}
              {profile.lanoshi2lash && (
                <div>
                  <Label className="text-muted-foreground">Exchange Rate</Label>
                  <p>{profile.lanoshi2lash}</p>
                </div>
              )}
              {profile.payment_link && (
                <div>
                  <Label className="text-muted-foreground">Payment Link</Label>
                  <a
                    href={profile.payment_link}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="text-sm text-primary hover:underline flex items-center gap-1"
                  >
                    <Link className="h-3 w-3" />
                    {profile.payment_link}
                  </a>
                </div>
              )}
              {profile.created_at && (
                <div>
                  <Label className="text-muted-foreground">Profile Created</Label>
                  <p className="flex items-center gap-1">
                    <Calendar className="h-3 w-3" />
                    {format(new Date(profile.created_at * 1000), "d. MMM yyyy", { locale: sl })}
                  </p>
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
              {profile.orgasmic_profile && (
                <div className="md:col-span-2">
                  <Label className="text-muted-foreground">Orgasmic Profile</Label>
                  <p className="break-words">{profile.orgasmic_profile}</p>
                </div>
              )}
              {profile.statement_of_responsibility && (
                <div className="md:col-span-2">
                  <Label className="text-muted-foreground">Statement of Self-Responsibility</Label>
                  <p className="break-words">{profile.statement_of_responsibility}</p>
                </div>
              )}
            </div>

            {/* Payment Methods */}
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

            {/* Legacy Banking */}
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
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
