import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import { Progress } from "@/components/ui/progress";
import { Heart, Users } from "lucide-react";
import { useNostrProfileCache } from "@/hooks/useNostrProfileCache";
import { useNostrProjectDonations } from "@/hooks/useNostrProjectDonations";
import { ProjectData } from "@/hooks/useNostrProjects";
import { useNavigate } from "react-router-dom";

interface ProjectCardProps {
  project: ProjectData;
}

const ProjectCard = ({ project }: ProjectCardProps) => {
  const { profile } = useNostrProfileCache(project.ownerPubkey);
  const { donations, totalRaised, isLoading } = useNostrProjectDonations(project.id);
  const navigate = useNavigate();

  // Calculate funding stats from KIND 60200 donations
  const currentFunding = totalRaised;
  const goalAmount = parseFloat(project.fiatGoal) || 0;
  const backers = donations.length;
  const fundedPercentage = goalAmount > 0 ? Math.min(Math.round((currentFunding / goalAmount) * 100), 100) : 0;
  const isFullyFunded = currentFunding >= goalAmount && goalAmount > 0;

  const handleSupportProject = () => {
    navigate(`/100millionideas/project/${project.id}`);
  };

  return (
    <Card className="overflow-hidden hover:shadow-lg transition-shadow">
      {/* Cover Image */}
      {project.coverImage && (
        <div className="aspect-video w-full overflow-hidden">
          <img 
            src={project.coverImage} 
            alt={project.title}
            className="w-full h-full object-cover"
          />
        </div>
      )}

      <CardContent className="p-6 space-y-4">
        {/* Title */}
        <div className="flex items-start justify-between gap-2">
          <h3 className="text-2xl font-bold text-green-600 flex-1">
            {project.title}
          </h3>
          {isFullyFunded && (
            <Badge className="bg-green-500 text-white">Funded ✓</Badge>
          )}
        </div>

        {/* Short Description */}
        <p className="text-muted-foreground">
          {project.shortDesc}
        </p>

        {/* Project Initiator */}
        <div className="flex items-center gap-3 pt-2">
          <Avatar className="h-10 w-10">
            <AvatarImage src={profile?.picture} />
            <AvatarFallback>
              {profile?.display_name?.[0] || project.ownerPubkey.slice(0, 2).toUpperCase()}
            </AvatarFallback>
          </Avatar>
          <div>
            <p className="text-xs text-muted-foreground">Project Initiator</p>
            <p className="font-medium">
              {profile?.display_name || profile?.full_name || `${project.ownerPubkey.slice(0, 8)}...`}
            </p>
          </div>
        </div>

        {/* Funding Stats */}
        <div className="flex items-baseline justify-between pt-4">
          <div>
            <span className="text-3xl font-bold">{currentFunding.toFixed(2)}</span>
            <span className="text-lg text-muted-foreground ml-1">{project.currency}</span>
          </div>
          <div className="text-right text-sm text-muted-foreground">
            goal: {goalAmount.toFixed(0)} {project.currency}
          </div>
        </div>

        {/* Progress Bar */}
        <Progress value={fundedPercentage} className="h-2" />

        {/* Backers and Funding Percentage */}
        <div className="flex items-center gap-4 text-sm text-muted-foreground">
          <div className="flex items-center gap-1">
            <Users className="h-4 w-4" />
            <span>{backers} {backers === 1 ? 'backer' : 'backers'}</span>
          </div>
          <span>{fundedPercentage}% funded</span>
        </div>

        {/* Support Button */}
        <Button 
          className="w-full bg-green-600 hover:bg-green-700 text-white disabled:opacity-50 disabled:cursor-not-allowed"
          onClick={handleSupportProject}
          disabled={isFullyFunded}
        >
          <Heart className="h-4 w-4 mr-2" />
          {isFullyFunded ? 'Fully Funded' : 'Support Project'}
        </Button>
      </CardContent>
    </Card>
  );
};

export default ProjectCard;
