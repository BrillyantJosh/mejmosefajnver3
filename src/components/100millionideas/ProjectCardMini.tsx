import { Card, CardContent } from "@/components/ui/card";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import { Progress } from "@/components/ui/progress";
import { useNostrProfileCache } from "@/hooks/useNostrProfileCache";
import { useNostrProjectDonations } from "@/hooks/useNostrProjectDonations";
import { ProjectData } from "@/hooks/useNostrProjects";
import { useNavigate } from "react-router-dom";

interface ProjectCardMiniProps {
  project: ProjectData;
}

const ProjectCardMini = ({ project }: ProjectCardMiniProps) => {
  const { profile } = useNostrProfileCache(project.ownerPubkey);
  const { donations, totalRaised } = useNostrProjectDonations(project.id);
  const navigate = useNavigate();

  const currentFunding = totalRaised;
  const goalAmount = parseFloat(project.fiatGoal) || 0;
  const fundedPercentage = goalAmount > 0 ? Math.min(Math.round((currentFunding / goalAmount) * 100), 100) : 0;
  const isFullyFunded = currentFunding >= goalAmount && goalAmount > 0;

  const handleClick = () => {
    navigate(`/100millionideas/project/${project.id}`);
  };

  return (
    <Card 
      className="overflow-hidden hover:shadow-md transition-shadow cursor-pointer h-full"
      onClick={handleClick}
    >
      {project.coverImage && (
        <div className="h-20 w-full overflow-hidden">
          <img 
            src={project.coverImage} 
            alt={project.title}
            className="w-full h-full object-cover"
          />
        </div>
      )}

      <CardContent className="p-2.5 space-y-2">
        <div className="flex items-start justify-between gap-1">
          <h3 className="font-medium text-sm text-green-600 line-clamp-2 flex-1">
            {project.title}
          </h3>
          {isFullyFunded && (
            <Badge className="bg-green-500 text-white text-[10px] px-1.5 py-0.5 shrink-0">✓</Badge>
          )}
        </div>

        <p className="text-[11px] text-muted-foreground line-clamp-2">
          {project.shortDesc}
        </p>

        <div className="flex items-center gap-2">
          <Avatar className="h-5 w-5">
            <AvatarImage src={profile?.picture} />
            <AvatarFallback className="text-[8px]">
              {profile?.display_name?.[0] || project.ownerPubkey.slice(0, 2).toUpperCase()}
            </AvatarFallback>
          </Avatar>
          <span className="text-[10px] text-muted-foreground truncate">
            {profile?.display_name || profile?.full_name || `${project.ownerPubkey.slice(0, 8)}...`}
          </span>
        </div>

        <div className="space-y-1">
          <div className="flex items-baseline justify-between">
            <span className="text-xs font-semibold">{currentFunding.toFixed(0)} {project.currency}</span>
            <span className="text-[10px] text-muted-foreground">{fundedPercentage}%</span>
          </div>
          <Progress value={fundedPercentage} className="h-1" />
        </div>
      </CardContent>
    </Card>
  );
};

export default ProjectCardMini;
