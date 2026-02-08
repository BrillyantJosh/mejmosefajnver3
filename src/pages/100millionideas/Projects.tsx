import { useNostrProjects } from "@/hooks/useNostrProjects";
import ProjectCard from "@/components/100millionideas/ProjectCard";
import ProjectsSummaryBar from "@/components/100millionideas/ProjectsSummaryBar";
import { Loader2, Layers } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useNavigate } from "react-router-dom";

const Projects = () => {
  const { projects, isLoading } = useNostrProjects();
  const navigate = useNavigate();

  return (
    <div className="container mx-auto p-6 space-y-6">
      <div className="flex items-start justify-between gap-4">
        <div>
          <h1 className="text-3xl font-bold">Projects</h1>
          <p className="text-muted-foreground mt-2">
            Browse and discover innovative projects on LanaCrowd
          </p>
        </div>
        <Button
          onClick={() => navigate('/100millionideas/batch-funding')}
          className="bg-green-600 hover:bg-green-700 text-white"
        >
          <Layers className="h-4 w-4 mr-2" />
          Batch Funding
        </Button>
      </div>

      <ProjectsSummaryBar />

      {isLoading ? (
        <div className="flex items-center justify-center py-12">
          <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
          <span className="ml-2 text-muted-foreground">Loading projects...</span>
        </div>
      ) : projects.length === 0 ? (
        <div className="text-center py-12">
          <p className="text-muted-foreground">No projects found yet.</p>
          <p className="text-sm text-muted-foreground mt-2">
            Be the first to create a project on LanaCrowd!
          </p>
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
          {projects.map((project) => (
            <ProjectCard key={project.eventId} project={project} />
          ))}
        </div>
      )}
    </div>
  );
};

export default Projects;
