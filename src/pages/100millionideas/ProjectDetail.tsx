import { useParams, useNavigate } from "react-router-dom";
import { useNostrProjects } from "@/hooks/useNostrProjects";
import { useNostrProjectDonations } from "@/hooks/useNostrProjectDonations";
import { useNostrProfileCache } from "@/hooks/useNostrProfileCache";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import { ArrowLeft, Users, Target, Wallet, ExternalLink } from "lucide-react";
import { Loader2 } from "lucide-react";
import { format } from "date-fns";

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

const ProjectDetail = () => {
  const { projectId } = useParams<{ projectId: string }>();
  const navigate = useNavigate();
  const { projects, isLoading: projectsLoading } = useNostrProjects();
  const project = projects.find(p => p.id === projectId);
  const { donations, totalRaised } = useNostrProjectDonations(projectId || '');
  const { profile: ownerProfile } = useNostrProfileCache(project?.ownerPubkey || null);

  if (projectsLoading) {
    return (
      <div className="flex items-center justify-center min-h-screen">
        <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
      </div>
    );
  }

  if (!project) {
    return (
      <div className="container mx-auto p-6">
        <p className="text-center text-muted-foreground">Project not found</p>
      </div>
    );
  }

  const fundingGoal = parseFloat(project.fiatGoal);
  const percentageFunded = fundingGoal > 0 ? (totalRaised / fundingGoal) * 100 : 0;

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
            Back
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
      </div>

      {/* Content */}
      <div className="container mx-auto p-6 max-w-4xl space-y-8">
        {/* Title & Description */}
        <div>
          <h1 className="text-3xl font-bold mb-2">{project.title}</h1>
          <p className="text-muted-foreground">{project.shortDesc}</p>
          <p className="text-sm text-muted-foreground mt-2">
            Updated {format(new Date(project.createdAt * 1000), 'dd/MM/yyyy')}
          </p>
        </div>

        {/* Project Initiator */}
        <Card className="p-6">
          <div className="flex items-start gap-4">
            <Users className="h-5 w-5 mt-1 text-muted-foreground" />
            <div className="flex-1">
              <h2 className="text-xl font-semibold mb-4">Project Initiator</h2>
              <div className="flex items-start gap-4">
                <Avatar className="h-12 w-12">
                  <AvatarImage src={ownerProfile?.picture} />
                  <AvatarFallback>
                    {(ownerProfile?.display_name || ownerProfile?.full_name || 'U')[0].toUpperCase()}
                  </AvatarFallback>
                </Avatar>
                <div className="flex-1">
                  <h3 className="font-semibold">
                    {ownerProfile?.display_name || ownerProfile?.full_name || 'Anonymous'}
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
                Statement of Responsibility
              </h2>
              <p className="text-muted-foreground italic">
                "{project.responsibilityStatement}"
              </p>
            </div>
          </div>
        </Card>

        {/* Project Description */}
        <div>
          <h2 className="text-2xl font-bold mb-4">Project Description</h2>
          <div className="prose prose-sm max-w-none">
            <p className="whitespace-pre-wrap text-muted-foreground">{project.content}</p>
          </div>
        </div>

        {/* Project Video */}
        {project.videos.length > 0 && (
          <div>
            <h2 className="text-2xl font-bold mb-4 flex items-center gap-2">
              <span>📹</span> Project Video
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
            <h2 className="text-2xl font-bold mb-4">Project Gallery</h2>
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
              Project Participants
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
          <h3 className="font-semibold mb-2">Project Type</h3>
          <Badge variant="secondary">{project.projectType || 'Not specified'}</Badge>
        </div>

        {/* Funding Goal */}
        <Card className="p-6">
          <div className="flex items-start gap-4 mb-6">
            <Target className="h-5 w-5 mt-1 text-muted-foreground" />
            <div className="flex-1">
              <h2 className="text-2xl font-bold mb-4">Funding Goal</h2>
              <div className="space-y-4">
                <div>
                  <div className="flex items-baseline gap-2 mb-2">
                    <span className="text-3xl font-bold text-green-500">
                      {totalRaised.toFixed(2)} {project.currency}
                    </span>
                    <span className="text-muted-foreground">
                      of {fundingGoal.toFixed(2)} {project.currency}
                    </span>
                  </div>
                  <p className="text-sm text-muted-foreground">
                    {percentageFunded.toFixed(1)}% funded
                  </p>
                </div>

                <div className="flex items-center gap-2 text-sm text-muted-foreground">
                  <Wallet className="h-4 w-4" />
                  <span>Project Wallet</span>
                </div>
                <p className="font-mono text-sm break-all bg-muted p-2 rounded">
                  {project.wallet}
                </p>
              </div>
            </div>
          </div>

          <Button className="w-full bg-green-500 hover:bg-green-600 text-white">
            Donate with LANA
          </Button>
        </Card>

        {/* Donations Received */}
        <div>
          <h2 className="text-2xl font-bold mb-4 flex items-center gap-2">
            💰 Donations Received
          </h2>
          {donations.length === 0 ? (
            <p className="text-center text-muted-foreground py-8">No donations yet</p>
          ) : (
            <div className="space-y-4">
              {donations.map((donation) => (
                <DonationItem key={donation.eventId} donation={donation} />
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
};

const ParticipantCard = ({ pubkey }: { pubkey: string }) => {
  const { profile } = useNostrProfileCache(pubkey);

  return (
    <div className="flex items-center gap-4">
      <Avatar>
        <AvatarImage src={profile?.picture} />
        <AvatarFallback>
          {(profile?.display_name || 'U')[0].toUpperCase()}
        </AvatarFallback>
      </Avatar>
      <div>
        <p className="font-semibold">
          {profile?.display_name || profile?.full_name || 'Anonymous'}
        </p>
      </div>
    </div>
  );
};

const DonationItem = ({ donation }: { donation: any }) => {
  const { profile } = useNostrProfileCache(donation.supporterPubkey);

  return (
    <Card className="p-4">
      <div className="flex items-start gap-4">
        <Avatar>
          <AvatarImage src={profile?.picture} />
          <AvatarFallback>
            {(profile?.display_name || 'U')[0].toUpperCase()}
          </AvatarFallback>
        </Avatar>
        <div className="flex-1">
          <div className="flex justify-between items-start mb-2">
            <div>
              <p className="font-semibold">
                {profile?.display_name || profile?.full_name || 'Anonymous'}
              </p>
              <p className="text-sm text-muted-foreground">
                {format(new Date(donation.timestampPaid * 1000), 'dd MMM yyyy, HH:mm')}
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
            href={`https://insight.lana.foundation/tx/${donation.txid}`}
            target="_blank"
            rel="noopener noreferrer"
            className="text-xs text-primary hover:underline flex items-center gap-1"
          >
            View transaction <ExternalLink className="h-3 w-3" />
          </a>
        </div>
      </div>
    </Card>
  );
};

export default ProjectDetail;
