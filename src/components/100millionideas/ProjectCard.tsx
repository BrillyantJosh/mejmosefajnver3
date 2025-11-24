import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Heart, Users } from "lucide-react";
import { useNostrProfileCache } from "@/hooks/useNostrProfileCache";
import { ProjectData } from "@/hooks/useNostrProjects";
import { useNavigate } from "react-router-dom";

interface ProjectCardProps {
  project: ProjectData;
}

const ProjectCard = ({ project }: ProjectCardProps) => {
  const { profile } = useNostrProfileCache(project.ownerPubkey);
  const navigate = useNavigate();

  // Calculate funding stats (placeholder - will be updated when we implement donations)
  const currentFunding = 0;
  const goalAmount = parseFloat(project.fiatGoal) || 0;
  const backers = 0;
  const fundedPercentage = goalAmount > 0 ? Math.round((currentFunding / goalAmount) * 100) : 0;

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
        <h3 className="text-2xl font-bold text-green-600">
          {project.title}
        </h3>

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

        {/* Backers and Funding Percentage */}
        <div className="flex items-center gap-4 text-sm text-muted-foreground">
          <div className="flex items-center gap-1">
            <Users className="h-4 w-4" />
            <span>{backers} backers</span>
          </div>
          <span>{fundedPercentage}% funded</span>
        </div>

        {/* Support Button */}
        <Button 
          className="w-full bg-green-600 hover:bg-green-700 text-white"
          onClick={handleSupportProject}
        >
          <Heart className="h-4 w-4 mr-2" />
          Support Project
        </Button>
      </CardContent>
    </Card>
  );
};

export default ProjectCard;
