import { useMemo } from 'react';
import { useNostrProfilesCacheBulk } from './useNostrProfilesCacheBulk';
import { getProxiedImageUrl } from '@/lib/imageProxy';

export interface SellerProfile {
  pubkey: string;
  name?: string;
  display_name?: string;
  picture?: string;
  about?: string;
}

export const useNostrSellerProfiles = (pubkeys: string[]) => {
  // Use bulk cache hook
  const { profiles: cachedProfiles, isLoading } = useNostrProfilesCacheBulk(pubkeys);

  // Map cached profiles to SellerProfile format
  const profiles = useMemo(() => {
    const profileMap = new Map<string, SellerProfile>();
    
    cachedProfiles.forEach((profile, pubkey) => {
      profileMap.set(pubkey, {
        pubkey,
        name: profile.full_name,
        display_name: profile.display_name,
        picture: getProxiedImageUrl(profile.picture),
        about: profile.about,
      });
    });
    
    return profileMap;
  }, [cachedProfiles]);

  return { profiles, isLoading };
};
