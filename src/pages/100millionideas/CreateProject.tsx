import { useNavigate } from "react-router-dom";
import { Button } from "@/components/ui/button";
import { ArrowLeft, PlusCircle, Ban } from "lucide-react";
import ProjectForm from "@/components/100millionideas/ProjectForm";
import { useAdmin } from "@/contexts/AdminContext";

export default function CreateProject() {
  const navigate = useNavigate();
  const { appSettings } = useAdmin();

  // Guard: block page when admin has disabled new project creation
  if (appSettings?.new_projects_100millionideas === false) {
    return (
      <div className="container mx-auto p-6 max-w-2xl pb-24">
        <div className="flex flex-col items-center justify-center py-16 text-center">
          <div className="h-16 w-16 rounded-full bg-muted flex items-center justify-center mb-4">
            <Ban className="h-8 w-8 text-muted-foreground" />
          </div>
          <h2 className="text-lg font-semibold">Creating new projects is currently disabled</h2>
          <p className="text-sm text-muted-foreground mt-2 max-w-sm">
            The administrator has temporarily disabled new project creation. You can still browse and edit your existing projects.
          </p>
          <Button
            variant="outline"
            className="mt-6"
            onClick={() => navigate("/100millionideas/projects")}
          >
            <ArrowLeft className="h-4 w-4 mr-2" />
            Back to Projects
          </Button>
        </div>
      </div>
    );
  }

  return (
    <div className="container mx-auto p-6 max-w-2xl pb-24">
      <div className="flex items-center gap-3 mb-6">
        <Button
          variant="ghost"
          size="icon"
          onClick={() => navigate("/100millionideas/projects")}
        >
          <ArrowLeft className="h-5 w-5" />
        </Button>
        <PlusCircle className="h-6 w-6 text-primary" />
        <h1 className="text-2xl font-bold">Create Project</h1>
      </div>

      <ProjectForm
        mode="create"
        onSubmitSuccess={() => navigate("/100millionideas/my-projects")}
      />
    </div>
  );
}
