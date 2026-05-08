import { useNavigate } from "react-router-dom";
import { Button } from "@/components/ui/button";
import { ArrowLeft, PlusCircle, Ban, Sparkles, Loader2 } from "lucide-react";
import ProjectForm from "@/components/100millionideas/ProjectForm";
import { useAdmin } from "@/contexts/AdminContext";
import { useNostrLana8Wonder } from "@/hooks/useNostrLana8Wonder";

export default function CreateProject() {
  const navigate = useNavigate();
  const { appSettings } = useAdmin();
  const { status: lana8WonderStatus, isLoading: lana8WonderLoading } = useNostrLana8Wonder();

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

  // While we resolve the user's Lana8Wonder status, show a small loader
  // rather than flashing the form (which would let them start typing into
  // a form they may not actually be allowed to submit).
  if (lana8WonderLoading) {
    return (
      <div className="container mx-auto p-6 max-w-2xl pb-24">
        <div className="flex flex-col items-center justify-center py-16 text-center">
          <Loader2 className="h-8 w-8 text-muted-foreground animate-spin" />
        </div>
      </div>
    );
  }

  // Guard: only users who have an active Lana8Wonder annuity plan
  // (KIND 88888 with their pubkey in a #p tag) may create new projects.
  if (!lana8WonderStatus.exists) {
    return (
      <div className="container mx-auto p-6 max-w-2xl pb-24">
        <div className="flex flex-col items-center justify-center py-16 text-center">
          <div className="h-16 w-16 rounded-full bg-amber-500/10 flex items-center justify-center mb-4">
            <Sparkles className="h-8 w-8 text-amber-500" />
          </div>
          <h2 className="text-lg font-semibold">Lana8Wonder plan required</h2>
          <p className="text-sm text-muted-foreground mt-2 max-w-sm">
            Creating crowdfunding projects on LanaCrowd is reserved for members
            with an active Lana8Wonder plan. Activate your plan first and then
            return here to publish your project.
          </p>
          <div className="flex flex-col sm:flex-row gap-2 mt-6">
            <Button onClick={() => navigate("/lana8wonder")} className="gap-2">
              <Sparkles className="h-4 w-4" />
              Open Lana8Wonder
            </Button>
            <Button
              variant="outline"
              onClick={() => navigate("/100millionideas/projects")}
              className="gap-2"
            >
              <ArrowLeft className="h-4 w-4" />
              Back to Projects
            </Button>
          </div>
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
