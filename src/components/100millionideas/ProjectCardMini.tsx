import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Progress } from "@/components/ui/progress";
import { Users } from "lucide-react";
import { useNostrProjectDonations } from "@/hooks/useNostrProjectDonations";
import { ProjectData } from "@/hooks/useNostrProjects";
import { useNavigate } from "react-router-dom";

interface ProjectCardMiniProps {
  project: ProjectData;
}

const ProjectCardMini = ({ project }: ProjectCardMiniProps) => {
  const { donations, totalRaised } = useNostrProjectDonations(project.id);
  const navigate = useNavigate();

  const currentFunding = totalRaised;
  const goalAmount = parseFloat(project.fiatGoal) || 0;
  const backers = donations.length;
  const fundedPercentage = goalAmount > 0 ? Math.min(Math.round((currentFunding / goalAmount) * 100), 100) : 0;
  const isFullyFunded = currentFunding >= goalAmount && goalAmount > 0;

  const handleClick = () => {
    navigate(`/100millionideas/project/${project.id}`);
  };

  return (
    <Card 
      className={`cursor-pointer transition-all hover:shadow-md h-full ${
        isFullyFunded ? 'ring-2 ring-green-500 bg-green-500/10' : ''
      }`}
      onClick={handleClick}
    >
      {project.coverImage && (
        <div className="relative h-20 w-full overflow-hidden rounded-t-lg">
          <img 
            src={project.coverImage} 
            alt={project.title}
            className="h-full w-full object-cover"
          />
          {isFullyFunded && (
            <Badge className="absolute top-1 right-1 text-[10px] px-1.5 py-0.5 bg-green-500 text-white">
              Funded ✓
            </Badge>
          )}
        </div>
      )}
      
      <CardContent className={`p-2.5 ${!project.coverImage ? 'pt-2.5' : ''}`}>
        {!project.coverImage && isFullyFunded && (
          <Badge className="mb-1.5 text-[10px] px-1.5 py-0.5 bg-green-500 text-white">
            Funded ✓
          </Badge>
        )}
        
        <h3 className="font-medium text-sm line-clamp-2 mb-1 text-green-600">{project.title}</h3>
        
        <p className="text-[11px] text-muted-foreground line-clamp-1 mb-2">
          {project.shortDesc}
        </p>

        {/* Progress */}
        <div className="space-y-1">
          <Progress value={fundedPercentage} className="h-1.5" />
          <div className="flex items-center justify-between text-[10px] text-muted-foreground">
            <div className="flex items-center gap-1">
              <Users className="h-3 w-3" />
              <span>{backers}</span>
            </div>
            <span className="font-medium">{fundedPercentage}%</span>
          </div>
        </div>
      </CardContent>
    </Card>
  );
};

export default ProjectCardMini;
