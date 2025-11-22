import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";

export default function Own() {
  return (
    <div className="space-y-6">
      <Card>
        <CardHeader>
          <CardTitle>Unconditional Self Responsibility</CardTitle>
          <CardDescription>
            Take ownership of your actions and decisions
          </CardDescription>
        </CardHeader>
        <CardContent>
          <p className="text-muted-foreground">
            Welcome to OWN - your platform for managing unconditional self responsibility.
          </p>
        </CardContent>
      </Card>
    </div>
  );
}
