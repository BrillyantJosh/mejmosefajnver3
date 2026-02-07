import { useNavigate } from "react-router-dom";
import { Button } from "@/components/ui/button";
import { ArrowLeft, PlusCircle } from "lucide-react";
import ProjectForm from "@/components/100millionideas/ProjectForm";

export default function CreateProject() {
  const navigate = useNavigate();

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
