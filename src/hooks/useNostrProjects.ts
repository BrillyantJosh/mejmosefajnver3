import { useState, useEffect } from 'react';
import { SimplePool, Event } from 'nostr-tools';
import { useSystemParameters } from '@/contexts/SystemParametersContext';

const AUTHORITY_PUBKEY = '18a908e89354fb2d142d864bfcbea7a7ed4486c8fb66b746fcebe66ed372115e';

export interface ProjectData {
  id: string;
  eventId: string;
  pubkey: string;
  createdAt: number;
  title: string;
  shortDesc: string;
  content: string;
  fiatGoal: string;
  currency: string;
  wallet: string;
  responsibilityStatement: string;
  projectType: string;
  status: 'draft' | 'active';
  ownerPubkey: string;
  participants: string[];
  coverImage?: string;
  galleryImages: string[];
  videos: string[];
  files: string[];
  isBlocked: boolean;
}

const parseProjectEvent = (event: Event): ProjectData | null => {
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
    const responsibilityStatement = getTag('responsibility_statement');
    const projectType = getTag('project_type');
    const status = getTag('status') as 'draft' | 'active' | undefined;

    if (!title || !shortDesc || !fiatGoal || !currency || !wallet) {
      return null;
    }

    // Get owner pubkey
    const ownerTag = event.tags.find(t => t[0] === 'p' && t[2] === 'owner');
    const ownerPubkey = ownerTag?.[1] || event.pubkey;

    // Get participants
    const participantTags = getAllTags('p').filter(t => t[2] === 'participant');
    const participants = participantTags.map(t => t[1]);

    // Get images
    const imageTags = getAllTags('img');
    const coverImage = imageTags.find(t => t[2] === 'cover')?.[1];
    const galleryImages = imageTags.filter(t => t[2] === 'gallery').map(t => t[1]);

    // Get videos
    const videoTags = getAllTags('video');
    const videos = videoTags.map(t => t[1]);

    // Get files
    const fileTags = getAllTags('file');
    const files = fileTags.map(t => t[1]);

    return {
      id: dTag,
      eventId: event.id,
      pubkey: event.pubkey,
      createdAt: event.created_at,
      title,
      shortDesc,
      content: event.content,
      fiatGoal,
      currency,
      wallet,
      responsibilityStatement: responsibilityStatement || '',
      projectType: projectType || 'Inspiration',
      status: status || 'active',
      ownerPubkey,
      participants,
      coverImage,
      galleryImages,
      videos,
      files,
      isBlocked: false
    };
  } catch (error) {
    console.error('Error parsing project event:', error);
    return null;
  }
};

export const useNostrProjects = () => {
  const { parameters } = useSystemParameters();
  const [projects, setProjects] = useState<ProjectData[]>([]);
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    if (!parameters?.relays) {
      // Don't set loading to false - wait for relays to be available
      return;
    }

    const fetchProjects = async () => {
      const pool = new SimplePool();
      setIsLoading(true);

      try {
        // Fetch all KIND 31234 project events
        const projectEvents = await pool.querySync(parameters.relays, {
          kinds: [31234],
          limit: 100
        });

        console.log(`📦 Fetched ${projectEvents.length} KIND 31234 project events`);

        // Fetch all KIND 31235 visibility events from authority
        const visibilityEvents = await pool.querySync(parameters.relays, {
          kinds: [31235],
          authors: [AUTHORITY_PUBKEY],
          limit: 100
        });

        console.log(`🔐 Fetched ${visibilityEvents.length} KIND 31235 visibility events`);

        // Parse projects
        const parsedProjects = projectEvents
          .map(parseProjectEvent)
          .filter((p): p is ProjectData => p !== null);

        // Create a map of blocked projects
        const blockedProjects = new Set<string>();
        visibilityEvents.forEach(event => {
          const dTag = event.tags.find(t => t[0] === 'd')?.[1];
          const status = event.tags.find(t => t[0] === 'status')?.[1];
          
          if (dTag && status === 'blocked') {
            blockedProjects.add(dTag);
          }
        });

        // Filter out blocked projects and draft projects
        const visibleProjects = parsedProjects.filter(project => {
          const isBlocked = blockedProjects.has(project.id);
          const isDraft = project.status === 'draft';
          if (isBlocked) {
            console.log(`🚫 Project "${project.title}" is blocked`);
          }
          if (isDraft) {
            console.log(`📝 Project "${project.title}" is draft, hiding from public`);
          }
          return !isBlocked && !isDraft;
        });

        console.log(`✅ ${visibleProjects.length} visible projects out of ${parsedProjects.length} total`);
        setProjects(visibleProjects);
      } catch (error) {
        console.error('Error fetching projects:', error);
      } finally {
        setIsLoading(false);
        pool.close(parameters.relays);
      }
    };

    fetchProjects();
  }, [parameters?.relays]);

  // Keep loading true until relays are available
  const isReady = !!parameters?.relays;

  return { projects, isLoading: isLoading || !isReady };
};
