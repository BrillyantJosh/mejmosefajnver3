import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";

const Projects = () => {
  return (
    <div className="container mx-auto p-6 space-y-6">
      <div>
        <h1 className="text-3xl font-bold">Projects</h1>
        <p className="text-muted-foreground mt-2">
          Browse and discover innovative projects
        </p>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>100 Million Ideas Projects</CardTitle>
          <CardDescription>
            This is the Projects page. Content will be added based on your specifications.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <p className="text-muted-foreground">
            Project listings will appear here.
          </p>
        </CardContent>
      </Card>
    </div>
  );
};

export default Projects;
