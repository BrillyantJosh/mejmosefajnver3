import { useNavigate } from "react-router-dom";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { PlusCircle, Pencil, ImageOff } from "lucide-react";
import { useNostrUserProjects, UserProjectData } from "@/hooks/useNostrUserProjects";

const MyProjects = () => {
  const navigate = useNavigate();
  const { projects, isLoading } = useNostrUserProjects();

  if (isLoading) {
    return (
      <div className="container mx-auto p-6 space-y-6">
        <div className="flex items-center justify-between">
          <h1 className="text-3xl font-bold">My Projects</h1>
        </div>
        <Skeleton className="h-32 w-full" />
        <Skeleton className="h-32 w-full" />
      </div>
    );
  }

  return (
    <div className="container mx-auto p-6 space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold">My Projects</h1>
          <p className="text-muted-foreground mt-1">
            {projects.length} project{projects.length !== 1 ? "s" : ""}
          </p>
        </div>
        <Button
          onClick={() => navigate("/100millionideas/create-project")}
          className="gap-2"
        >
          <PlusCircle className="h-4 w-4" />
          New Project
        </Button>
      </div>

      {projects.length === 0 ? (
        <Card>
          <CardContent className="py-12 text-center space-y-4">
            <p className="text-muted-foreground">You haven't created any projects yet.</p>
            <Button
              onClick={() => navigate("/100millionideas/create-project")}
              className="gap-2"
            >
              <PlusCircle className="h-4 w-4" />
              Create Your First Project
            </Button>
          </CardContent>
        </Card>
      ) : (
        <div className="space-y-4">
          {projects.map((project) => (
            <ProjectCard key={project.id} project={project} />
          ))}
        </div>
      )}
    </div>
  );
};

const ProjectCard = ({ project }: { project: UserProjectData }) => {
  const navigate = useNavigate();

  const progressPercent = Math.min(project.percentFunded, 100);

  return (
    <Card className="overflow-hidden">
      <CardContent className="p-0">
        <div className="flex flex-col sm:flex-row">
          {/* Cover image */}
          <div className="sm:w-40 h-32 sm:h-auto bg-muted flex-shrink-0">
            {project.coverImage ? (
              <img
                src={project.coverImage}
                alt={project.title}
                className="w-full h-full object-cover"
              />
            ) : (
              <div className="w-full h-full flex items-center justify-center">
                <ImageOff className="h-8 w-8 text-muted-foreground/50" />
              </div>
            )}
          </div>

          {/* Content */}
          <div className="flex-1 p-4 flex flex-col justify-between">
            <div>
              <div className="flex items-center gap-2 mb-1">
                <h3 className="font-semibold text-lg">{project.title}</h3>
                <Badge variant={project.status === "active" ? "default" : "secondary"}>
                  {project.status}
                </Badge>
                {project.isBlocked && (
                  <Badge variant="destructive">Blocked</Badge>
                )}
              </div>
              <p className="text-sm text-muted-foreground line-clamp-2 mb-3">
                {project.shortDesc}
              </p>
            </div>

            {/* Funding progress */}
            <div className="space-y-2">
              <div className="flex justify-between text-sm">
                <span className="text-muted-foreground">
                  {project.totalRaised.toFixed(2)} / {project.fiatGoal.toFixed(2)} {project.currency}
                </span>
                <span className="font-medium">{progressPercent.toFixed(1)}%</span>
              </div>
              <div className="h-2 bg-muted rounded-full overflow-hidden">
                <div
                  className="h-full bg-primary rounded-full transition-all"
                  style={{ width: `${progressPercent}%` }}
                />
              </div>
              <div className="flex justify-between items-center">
                <span className="text-xs text-muted-foreground">
                  {project.donationCount} donation{project.donationCount !== 1 ? "s" : ""}
                </span>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => navigate(`/100millionideas/edit-project/${project.id}`)}
                  className="gap-1"
                >
                  <Pencil className="h-3 w-3" />
                  Edit
                </Button>
              </div>
            </div>
          </div>
        </div>
      </CardContent>
    </Card>
  );
};

export default MyProjects;
