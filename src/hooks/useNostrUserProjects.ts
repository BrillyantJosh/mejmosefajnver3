import { useState, useEffect, useMemo } from 'react';
import { Event } from 'nostr-tools';
import { useSystemParameters } from '@/contexts/SystemParametersContext';
import { useAuth } from '@/contexts/AuthContext';
import { supabase } from '@/integrations/supabase/client';

const AUTHORITY_PUBKEY = '18a908e89354fb2d142d864bfcbea7a7ed4486c8fb66b746fcebe66ed372115e';

export interface UserProjectData {
  id: string;
  eventId: string;
  pubkey: string;
  createdAt: number;
  title: string;
  shortDesc: string;
  content: string;
  fiatGoal: number;
  currency: string;
  wallet: string;
  status: 'draft' | 'active';
  ownerPubkey: string;
  participants: string[];
  coverImage?: string;
  isBlocked: boolean;
  // Donation stats
  totalRaised: number;
  donationCount: number;
  percentFunded: number;
  amountRemaining: number;
  isFullyFunded: boolean;
  donations: UserProjectDonation[];
}

export interface UserProjectDonation {
  eventId: string;
  supporterPubkey: string;
  supporterName?: string;
  amountFiat: number;
  amountLanoshis: string;
  currency: string;
  txid: string;
  timestampPaid: number;
  message: string;
  fromWallet: string;
}

interface Kind0Profile {
  pubkey: string;
  name?: string;
  display_name?: string;
}

export const useNostrUserProjects = () => {
  const { parameters } = useSystemParameters();
  const { session } = useAuth();
  const [projects, setProjects] = useState<UserProjectData[]>([]);
  const [allProjects, setAllProjects] = useState<UserProjectData[]>([]);
  const [profiles, setProfiles] = useState<Kind0Profile[]>([]);
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    if (!parameters?.relays || !session?.nostrHexId) {
      setIsLoading(false);
      return;
    }

    const fetchUserProjects = async () => {
      setIsLoading(true);

      try {
        // Fetch all data in parallel using server-side relay queries
        const [projectRes, visibilityRes, donationRes, profileRes] = await Promise.all([
          supabase.functions.invoke('query-nostr-events', {
            body: { filter: { kinds: [31234], limit: 200 }, timeout: 15000 },
          }),
          supabase.functions.invoke('query-nostr-events', {
            body: { filter: { kinds: [31235], authors: [AUTHORITY_PUBKEY], limit: 100 }, timeout: 10000 },
          }),
          supabase.functions.invoke('query-nostr-events', {
            body: { filter: { kinds: [60200], limit: 500 }, timeout: 15000 },
          }),
          supabase.functions.invoke('query-nostr-events', {
            body: { filter: { kinds: [0], limit: 500 }, timeout: 10000 },
          }),
        ]);

        const projectEvents: Event[] = projectRes.data?.events || [];
        const visibilityEvents: Event[] = visibilityRes.data?.events || [];
        const donationEvents: Event[] = donationRes.data?.events || [];
        const profileEvents: Event[] = profileRes.data?.events || [];

        // Parse profiles for name lookups
        const profileMap = new Map<string, Kind0Profile>();
        profileEvents.forEach((event: Event) => {
          try {
            const content = JSON.parse(event.content);
            const existing = profileMap.get(event.pubkey);
            if (!existing || event.created_at > (existing as any).created_at) {
              profileMap.set(event.pubkey, {
                pubkey: event.pubkey,
                name: content.name,
                display_name: content.display_name,
              });
            }
          } catch {}
        });
        setProfiles(Array.from(profileMap.values()));

        // Create blocked projects set
        const blockedProjects = new Set<string>();
        visibilityEvents.forEach(event => {
          const dTag = event.tags.find(t => t[0] === 'd')?.[1];
          const status = event.tags.find(t => t[0] === 'status')?.[1];
          if (dTag && status === 'blocked') blockedProjects.add(dTag);
        });

        // Group donations by project
        const donationsByProject = new Map<string, Event[]>();
        donationEvents.forEach(event => {
          const projectId = event.tags.find(t => t[0] === 'project')?.[1];
          if (projectId) {
            const existing = donationsByProject.get(projectId) || [];
            existing.push(event);
            donationsByProject.set(projectId, existing);
          }
        });

        // Parse all projects
        const parsedProjects: UserProjectData[] = [];

        projectEvents.forEach(event => {
          const parsed = parseProjectWithDonations(event, donationsByProject, blockedProjects, profileMap);
          if (parsed) parsedProjects.push(parsed);
        });

        // Store all visible projects (not blocked, not draft)
        const visibleProjects = parsedProjects.filter(p => !p.isBlocked && p.status !== 'draft');
        setAllProjects(visibleProjects);

        // Filter for user's own projects - check both event.pubkey and owner p-tag
        // Projects created on 100million.fun may have a different event signer
        const userProjects = parsedProjects.filter(
          p => p.pubkey === session.nostrHexId || p.ownerPubkey === session.nostrHexId
        );
        setProjects(userProjects);

        console.log(`📊 User has ${userProjects.length} projects, ${visibleProjects.length} total visible`);
      } catch (error) {
        console.error('Error fetching user projects:', error);
      } finally {
        setIsLoading(false);
      }
    };

    fetchUserProjects();
  }, [parameters?.relays, session?.nostrHexId]);

  // Search function for projects
  const searchProjects = useMemo(() => {
    return (query: string) => {
      if (!query.trim()) return allProjects;
      const lowerQuery = query.toLowerCase();

      return allProjects.filter(project => {
        if (project.title.toLowerCase().includes(lowerQuery)) return true;
        if (project.shortDesc.toLowerCase().includes(lowerQuery)) return true;

        const ownerProfile = profiles.find(p => p.pubkey === project.ownerPubkey);
        if (ownerProfile?.name?.toLowerCase().includes(lowerQuery)) return true;
        if (ownerProfile?.display_name?.toLowerCase().includes(lowerQuery)) return true;

        return false;
      });
    };
  }, [allProjects, profiles]);

  // Get profile name helper
  const getProfileName = (pubkey: string): string | undefined => {
    const profile = profiles.find(p => p.pubkey === pubkey);
    return profile?.display_name || profile?.name;
  };

  // Stats for user's projects
  const stats = useMemo(() => {
    const totalRaised = projects.reduce((sum, p) => sum + p.totalRaised, 0);
    const totalGoal = projects.reduce((sum, p) => sum + p.fiatGoal, 0);
    const totalDonations = projects.reduce((sum, p) => sum + p.donationCount, 0);
    const fullyFundedCount = projects.filter(p => p.isFullyFunded).length;
    const activeCount = projects.filter(p => p.status === 'active' && !p.isBlocked).length;
    const draftCount = projects.filter(p => p.status === 'draft').length;

    return {
      projectCount: projects.length,
      totalRaised,
      totalGoal,
      totalDonations,
      overallPercentFunded: totalGoal > 0 ? Math.round((totalRaised / totalGoal) * 100) : 0,
      fullyFundedCount,
      activeCount,
      draftCount,
    };
  }, [projects]);

  return {
    projects,
    allProjects,
    stats,
    isLoading,
    searchProjects,
    getProfileName,
    profiles
  };
};

function parseProjectWithDonations(
  event: Event,
  donationsByProject: Map<string, Event[]>,
  blockedProjects: Set<string>,
  profileMap: Map<string, Kind0Profile>
): UserProjectData | null {
  try {
    const getTag = (tagName: string, index: number = 1): string | undefined => {
      const tag = event.tags.find(t => t[0] === tagName);
      return tag?.[index];
    };

    const getAllTags = (tagName: string): string[][] => {
      return event.tags.filter(t => t[0] === tagName);
    };

    const dTag = getTag('d');
    if (!dTag) return null;

    const title = getTag('title');
    const shortDesc = getTag('short_desc');
    const fiatGoal = getTag('fiat_goal');
    const currency = getTag('currency');
    const wallet = getTag('wallet');
    const status = getTag('status') as 'draft' | 'active' | undefined;
    const coverImage = getAllTags('img').find(t => t[2] === 'cover')?.[1];

    if (!title || !shortDesc || !fiatGoal || !currency || !wallet) return null;

    const ownerTag = event.tags.find(t => t[0] === 'p' && t[2] === 'owner');
    const ownerPubkey = ownerTag?.[1] || event.pubkey;
    const participantTags = getAllTags('p').filter(t => t[2] === 'participant');
    const participants = participantTags.map(t => t[1]);

    const isBlocked = blockedProjects.has(dTag);
    const goalAmount = parseFloat(fiatGoal) || 0;

    // Parse donations for this project
    const projectDonations = donationsByProject.get(dTag) || [];
    const donations: UserProjectDonation[] = [];
    let totalRaised = 0;

    projectDonations.forEach(donationEvent => {
      const supporterTag = donationEvent.tags.find(t => t[0] === 'p' && t[2] === 'supporter')?.[1];
      const amountFiatTag = donationEvent.tags.find(t => t[0] === 'amount_fiat')?.[1];
      const amountLanoshisTag = donationEvent.tags.find(t => t[0] === 'amount_lanoshis')?.[1];
      const txTag = donationEvent.tags.find(t => t[0] === 'tx')?.[1];
      const timestampTag = donationEvent.tags.find(t => t[0] === 'timestamp_paid')?.[1];
      const currencyTag = donationEvent.tags.find(t => t[0] === 'currency')?.[1];
      const fromWalletTag = donationEvent.tags.find(t => t[0] === 'from_wallet')?.[1];

      if (supporterTag && amountFiatTag && txTag) {
        const amountFiat = parseFloat(amountFiatTag) || 0;
        totalRaised += amountFiat;

        const supporterProfile = profileMap.get(supporterTag);

        donations.push({
          eventId: donationEvent.id,
          supporterPubkey: supporterTag,
          supporterName: supporterProfile?.display_name || supporterProfile?.name,
          amountFiat,
          amountLanoshis: amountLanoshisTag || '0',
          currency: currencyTag || currency,
          txid: txTag,
          timestampPaid: timestampTag ? parseInt(timestampTag) : donationEvent.created_at,
          message: donationEvent.content,
          fromWallet: fromWalletTag || '',
        });
      }
    });

    // Sort donations by timestamp (newest first)
    donations.sort((a, b) => b.timestampPaid - a.timestampPaid);

    const percentFunded = goalAmount > 0 ? Math.min(Math.round((totalRaised / goalAmount) * 100), 100) : 0;
    const amountRemaining = Math.max(goalAmount - totalRaised, 0);
    const isFullyFunded = totalRaised >= goalAmount && goalAmount > 0;

    return {
      id: dTag,
      eventId: event.id,
      pubkey: event.pubkey,
      createdAt: event.created_at,
      title,
      shortDesc,
      content: event.content,
      fiatGoal: goalAmount,
      currency,
      wallet,
      status: status || 'active',
      ownerPubkey,
      participants,
      coverImage,
      isBlocked,
      totalRaised,
      donationCount: donations.length,
      percentFunded,
      amountRemaining,
      isFullyFunded,
      donations,
    };
  } catch (error) {
    console.error('Error parsing project:', error);
    return null;
  }
}
