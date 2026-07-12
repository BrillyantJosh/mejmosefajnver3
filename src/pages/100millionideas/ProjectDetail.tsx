import { useState } from "react";
import { useParams, useNavigate } from "react-router-dom";
import { useLanacrowdProject } from "@/hooks/useLanacrowdProject";
import { useNostrProfileCache } from "@/hooks/useNostrProfileCache";
import { useAdmin } from "@/contexts/AdminContext";
import { useAuth } from "@/contexts/AuthContext";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { UserAvatar } from '@/components/ui/UserAvatar';
import { Badge } from "@/components/ui/badge";
import { ArrowLeft, Users, Target, Wallet, ExternalLink, Trophy, Languages } from "lucide-react";
import { Loader2 } from "lucide-react";
import { format } from "date-fns";
import { toast } from "@/hooks/use-toast";
import millionideasTranslations from "@/i18n/modules/millionideas";
import { useTranslation } from "@/i18n/I18nContext";

const getYoutubeEmbedUrl = (url: string): string => {
  try {
    // Extract video ID from various YouTube URL formats
    const regExp = /^.*(youtu.be\/|v\/|u\/\w\/|embed\/|watch\?v=|&v=)([^#&?]*).*/;
    const match = url.match(regExp);
    
    if (match && match[2].length === 11) {
      return `https://www.youtube.com/embed/${match[2]}`;
    }
    
    // If it's already an embed URL, return as is
    if (url.includes('/embed/')) {
      return url;
    }
    
    // Fallback to original URL
    return url;
  } catch (error) {
    console.error('Error parsing YouTube URL:', error);
    return url;
  }
};

type TranslateLang = 'sl' | 'en' | null;
type TranslatedFields = Partial<Pick<NonNullable<ReturnType<typeof useLanacrowdProject>['project']>,
  'title' | 'shortDesc' | 'content' | 'responsibilityStatement' | 'completionComment'>>;

const ProjectDetail = () => {
  const { t } = useTranslation(millionideasTranslations);
  const { projectId } = useParams<{ projectId: string }>();
  const navigate = useNavigate();
  const { project, donations, totalRaised, isLoading: projectsLoading } = useLanacrowdProject(projectId);
  const { is100MAdmin } = useAdmin();
  const { session } = useAuth();
  const isCompleted = !!project?.isCompleted;
  const isHidden = !!project?.isHidden;
  const completionComment = project?.completionComment;
  const { profile: ownerProfile } = useNostrProfileCache(project?.ownerPubkey || null);

  // ── Gemini Flash Lite translation ─────────────────────────────────────
  // We translate the user-visible long-form fields in parallel and cache
  // by language, so toggling Original ↔ SL ↔ EN is instant after first run.
  const [translateLang, setTranslateLang] = useState<TranslateLang>(null);
  const [isTranslating, setIsTranslating] = useState(false);
  const [translations, setTranslations] = useState<Record<'sl' | 'en', TranslatedFields | undefined>>({
    sl: undefined,
    en: undefined,
  });

  const translateField = async (
    text: string | undefined | null,
    lang: 'sl' | 'en',
  ): Promise<string | undefined> => {
    if (!text || !text.trim()) return undefined;
    try {
      const res = await fetch('/api/functions/translate-post', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          content: text,
          targetLanguage: lang,
          // Project page shows plain text (no markdown rendering), so ask the
          // translator to skip emphasis markers entirely.
          format: 'plain',
          nostrHexId: session?.nostrHexId,
        }),
      });
      if (!res.ok) return undefined;
      const data = await res.json();
      return typeof data.translatedText === 'string' ? data.translatedText : undefined;
    } catch (err) {
      console.error('translateField error:', err);
      return undefined;
    }
  };

  const handleTranslate = async (lang: 'sl' | 'en') => {
    setTranslateLang(lang);
    if (translations[lang] || !project) return; // already cached
    setIsTranslating(true);
    try {
      const [title, shortDesc, content, responsibilityStatement, completion] = await Promise.all([
        translateField(project.title, lang),
        translateField(project.shortDesc, lang),
        translateField(project.content, lang),
        translateField(project.responsibilityStatement, lang),
        translateField(project.completionComment, lang),
      ]);
      setTranslations((prev) => ({
        ...prev,
        [lang]: { title, shortDesc, content, responsibilityStatement, completionComment: completion },
      }));
    } catch (err) {
      console.error('Translation error:', err);
      toast({
        title: t('detail.toastTranslateFailedTitle'),
        description: t('detail.toastTranslateFailedDesc'),
        variant: 'destructive',
      });
    } finally {
      setIsTranslating(false);
    }
  };

  // Resolve a field through the active translation (falling back to original).
  const tr = (
    field: keyof TranslatedFields,
    fallback: string | undefined | null,
  ): string => {
    if (!translateLang) return fallback ?? '';
    const cached = translations[translateLang]?.[field];
    return cached ?? fallback ?? '';
  };

  if (projectsLoading) {
    return (
      <div className="flex items-center justify-center min-h-screen">
        <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
      </div>
    );
  }

  // Hidden projects: only 100M admins can view
  if (isHidden && !is100MAdmin) {
    return (
      <div className="container mx-auto p-6">
        <p className="text-center text-muted-foreground">{t('detail.notFound')}</p>
      </div>
    );
  }

  if (!project) {
    return (
      <div className="container mx-auto p-6">
        <p className="text-center text-muted-foreground">{t('detail.notFound')}</p>
      </div>
    );
  }

  const fundingGoal = project.fiatGoal || 0;
  const percentageFunded = fundingGoal > 0 ? (totalRaised / fundingGoal) * 100 : 0;
  const isFullyFunded = fundingGoal > 0 && totalRaised >= fundingGoal * 0.99;

  return (
    <div className="min-h-screen bg-background">
      {/* Header */}
      <div className="border-b bg-background sticky top-0 z-10">
        <div className="container mx-auto p-4">
          <Button
            variant="ghost"
            onClick={() => navigate("/100millionideas/projects")}
            className="gap-2"
          >
            <ArrowLeft className="h-4 w-4" />
            {t('detail.back')}
          </Button>
        </div>
      </div>

      {/* Cover Image */}
      <div className="relative h-64 md:h-96 bg-muted">
        {project.coverImage ? (
          <img
            src={project.coverImage}
            alt={project.title}
            className="w-full h-full object-cover"
          />
        ) : (
          <div className="w-full h-full flex items-center justify-center">
            <Target className="h-24 w-24 text-muted-foreground" />
          </div>
        )}
        <Badge className="absolute top-4 right-4 bg-background text-foreground">
          {project.currency}
        </Badge>
        {isCompleted && (
          <Badge className="absolute top-4 left-4 bg-green-600 text-white text-sm px-3 py-1 gap-1.5">
            <Trophy className="h-4 w-4" />
            {t('detail.completed')}
          </Badge>
        )}
      </div>

      {/* Content */}
      <div className="container mx-auto p-6 max-w-4xl space-y-8">
        {/* Translation toggle (Gemini 2.0 Flash Lite). Translates every text
            block on this page — title, short description, full content,
            statement of responsibility, completion comment. */}
        <div className="flex items-center justify-end">
          <div className="flex items-center gap-1 bg-muted rounded-full p-1">
            <Languages className="h-3.5 w-3.5 ml-2 mr-1 text-muted-foreground" />
            <button
              type="button"
              onClick={() => setTranslateLang(null)}
              disabled={isTranslating}
              className={`px-2.5 py-1 rounded-full text-xs font-medium transition-colors ${
                translateLang === null
                  ? 'bg-background text-foreground shadow-sm'
                  : 'text-muted-foreground hover:text-foreground'
              }`}
            >
              {t('detail.original')}
            </button>
            <button
              type="button"
              onClick={() => handleTranslate('sl')}
              disabled={isTranslating}
              className={`px-2.5 py-1 rounded-full text-xs font-medium transition-colors flex items-center gap-1 ${
                translateLang === 'sl'
                  ? 'bg-background text-foreground shadow-sm'
                  : 'text-muted-foreground hover:text-foreground'
              }`}
            >
              {isTranslating && translateLang === 'sl' && <Loader2 className="h-3 w-3 animate-spin" />}
              SL
            </button>
            <button
              type="button"
              onClick={() => handleTranslate('en')}
              disabled={isTranslating}
              className={`px-2.5 py-1 rounded-full text-xs font-medium transition-colors flex items-center gap-1 ${
                translateLang === 'en'
                  ? 'bg-background text-foreground shadow-sm'
                  : 'text-muted-foreground hover:text-foreground'
              }`}
            >
              {isTranslating && translateLang === 'en' && <Loader2 className="h-3 w-3 animate-spin" />}
              EN
            </button>
          </div>
        </div>

        {/* Title & Description */}
        <div>
          <h1 className="text-3xl font-bold mb-2">{tr('title', project.title)}</h1>
          <p className="text-muted-foreground whitespace-pre-wrap">{tr('shortDesc', project.shortDesc)}</p>
          <p className="text-sm text-muted-foreground mt-2">
            {t('detail.published')} {project.nostrCreatedAt ? format(new Date(project.nostrCreatedAt * 1000), 'dd/MM/yyyy') : '—'}
          </p>
        </div>

        {/* Completion Banner */}
        {isCompleted && (
          <Card className="p-6 border-green-500/30 bg-green-500/5">
            <div className="flex gap-3">
              <Trophy className="h-6 w-6 text-green-600 shrink-0 mt-0.5" />
              <div>
                <h2 className="text-xl font-semibold text-green-600 mb-1">
                  {t('detail.projectCompleted')}
                </h2>
                {completionComment && (
                  <p className="text-muted-foreground italic whitespace-pre-wrap">
                    "{tr('completionComment', completionComment)}"
                  </p>
                )}
              </div>
            </div>
          </Card>
        )}

        {/* Project Initiator */}
        <Card className="p-6">
          <div className="flex items-start gap-4">
            <Users className="h-5 w-5 mt-1 text-muted-foreground" />
            <div className="flex-1">
              <h2 className="text-xl font-semibold mb-4">{t('detail.projectInitiator')}</h2>
              <div className="flex items-start gap-4">
                <UserAvatar pubkey={project.ownerPubkey} picture={ownerProfile?.picture} name={ownerProfile?.display_name || ownerProfile?.full_name} className="h-12 w-12" />
                <div className="flex-1">
                  <h3 className="font-semibold">
                    {ownerProfile?.display_name || ownerProfile?.full_name || t('detail.anonymous')}
                  </h3>
                  {ownerProfile?.about && (
                    <p className="text-sm text-muted-foreground mt-2">{ownerProfile.about}</p>
                  )}
                </div>
              </div>
            </div>
          </div>
        </Card>

        {/* Statement of Responsibility */}
        <Card className="p-6 border-green-500/20 bg-green-500/5">
          <div className="flex gap-3">
            <div className="text-green-500 text-xl">○</div>
            <div>
              <h2 className="text-xl font-semibold text-green-500 mb-2">
                {t('detail.statementOfResponsibility')}
              </h2>
              <p className="text-muted-foreground italic whitespace-pre-wrap">
                "{tr('responsibilityStatement', project.responsibilityStatement)}"
              </p>
            </div>
          </div>
        </Card>

        {/* Project Description */}
        <div>
          <h2 className="text-2xl font-bold mb-4">{t('detail.projectDescription')}</h2>
          <div className="prose prose-sm max-w-none">
            <p className="whitespace-pre-wrap text-muted-foreground">{tr('content', project.content)}</p>
          </div>
        </div>

        {/* Project Video */}
        {project.videos.length > 0 && (
          <div>
            <h2 className="text-2xl font-bold mb-4 flex items-center gap-2">
              <span>📹</span> {t('detail.projectVideo')}
            </h2>
            <div className="aspect-video bg-muted rounded-lg overflow-hidden">
              <iframe
                src={getYoutubeEmbedUrl(project.videos[0])}
                className="w-full h-full"
                allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture"
                allowFullScreen
              />
            </div>
          </div>
        )}

        {/* Project Gallery */}
        {project.galleryImages.length > 0 && (
          <div>
            <h2 className="text-2xl font-bold mb-4">{t('detail.projectGallery')}</h2>
            <div className="grid grid-cols-2 gap-4">
              {project.galleryImages.map((image, index) => (
                <img
                  key={index}
                  src={image}
                  alt={`Gallery ${index + 1}`}
                  className="w-full aspect-video object-cover rounded-lg"
                />
              ))}
            </div>
          </div>
        )}

        {/* Project Participants */}
        {project.participants.length > 0 && (
          <div>
            <h2 className="text-2xl font-bold mb-4 flex items-center gap-2">
              <Users className="h-6 w-6" />
              {t('detail.projectParticipants')}
            </h2>
            <div className="space-y-4">
              {project.participants.map((pubkey) => (
                <ParticipantCard key={pubkey} pubkey={pubkey} />
              ))}
            </div>
          </div>
        )}

        {/* Project Type */}
        <div>
          <h3 className="font-semibold mb-2">{t('detail.projectType')}</h3>
          <Badge variant="secondary">{project.projectType || t('detail.notSpecified')}</Badge>
        </div>

        {/* Funding Goal */}
        <Card className="p-6">
          <div className="flex items-start gap-4 mb-6">
            <Target className="h-5 w-5 mt-1 text-muted-foreground" />
            <div className="flex-1">
              <h2 className="text-2xl font-bold mb-4">{t('detail.fundingGoal')}</h2>
              
              {isFullyFunded && (
                <div className="mb-4 p-4 bg-green-500/10 border border-green-500/20 rounded-lg">
                  <p className="text-green-600 dark:text-green-400 font-semibold text-center">
                    🎉 {t('detail.successfullyFunded')}
                  </p>
                </div>
              )}

              <div className="space-y-4">
                <div>
                  <div className="flex items-baseline gap-2 mb-2">
                    <span className="text-3xl font-bold text-green-500">
                      {totalRaised.toFixed(2)} {project.currency}
                    </span>
                    <span className="text-muted-foreground">
                      {t('detail.of')} {fundingGoal.toFixed(2)} {project.currency}
                    </span>
                  </div>
                  <p className="text-sm text-muted-foreground">
                    {t('detail.percentFunded', { pct: percentageFunded.toFixed(1) })}
                  </p>
                </div>

                <div className="flex items-center gap-2 text-sm text-muted-foreground">
                  <Wallet className="h-4 w-4" />
                  <span>{t('detail.projectWallet')}</span>
                </div>
                <p className="font-mono text-sm break-all bg-muted p-2 rounded">
                  {project.wallet}
                </p>
              </div>
            </div>
          </div>

          <Button 
            className="w-full bg-green-500 hover:bg-green-600 text-white disabled:opacity-50 disabled:cursor-not-allowed"
            onClick={() => navigate(`/100millionideas/donate/${projectId}`)}
            disabled={isFullyFunded}
          >
            {isFullyFunded ? t('detail.fullyFunded') : t('detail.donateWithLana')}
          </Button>
        </Card>

        {/* Donations Received */}
        <div>
          <h2 className="text-2xl font-bold mb-4 flex items-center gap-2">
            💰 {t('detail.donationsReceived')}
          </h2>
          {donations.length === 0 ? (
            <p className="text-center text-muted-foreground py-8">{t('detail.noDonations')}</p>
          ) : (
            <div className="space-y-4">
              {donations.map((donation) => (
                <DonationItem key={donation.id} donation={donation} />
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
};

const ParticipantCard = ({ pubkey }: { pubkey: string }) => {
  const { t } = useTranslation(millionideasTranslations);
  const { profile } = useNostrProfileCache(pubkey);

  return (
    <div className="flex items-center gap-4">
      <UserAvatar pubkey={pubkey} picture={profile?.picture} name={profile?.display_name || profile?.full_name} />
      <div>
        <p className="font-semibold">
          {profile?.display_name || profile?.full_name || t('detail.anonymous')}
        </p>
      </div>
    </div>
  );
};

const DonationItem = ({ donation }: { donation: any }) => {
  const { t } = useTranslation(millionideasTranslations);
  const { profile } = useNostrProfileCache(donation.supporterPubkey);

  return (
    <Card className="p-4">
      <div className="flex items-start gap-4">
        <UserAvatar pubkey={donation.supporterPubkey} picture={profile?.picture} name={profile?.display_name || profile?.full_name} />
        <div className="flex-1">
          <div className="flex justify-between items-start mb-2">
            <div>
              <p className="font-semibold">
                {profile?.display_name || profile?.full_name || t('detail.anonymous')}
              </p>
              <p className="text-sm text-muted-foreground">
                {format(new Date(donation.nostrCreatedAt * 1000), 'dd MMM yyyy, HH:mm')}
              </p>
            </div>
            <div className="text-right">
              <p className="font-bold text-green-500">
                {donation.amountFiat} {donation.currency}
              </p>
            </div>
          </div>
          {donation.message && (
            <p className="text-sm text-muted-foreground mb-2">{donation.message}</p>
          )}
          <a
            href={`https://chainz.cryptoid.info/lana/tx.dws?${donation.txId}`}
            target="_blank"
            rel="noopener noreferrer"
            className="text-xs text-primary hover:underline flex items-center gap-1"
          >
            {t('detail.viewTransaction')} <ExternalLink className="h-3 w-3" />
          </a>
        </div>
      </div>
    </Card>
  );
};

export default ProjectDetail;
