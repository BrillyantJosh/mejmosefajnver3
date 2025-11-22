import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";

export default function MyCases() {
  return (
    <div className="space-y-6">
      <Card>
        <CardHeader>
          <CardTitle>My Cases</CardTitle>
          <CardDescription>
            View and manage your cases
          </CardDescription>
        </CardHeader>
        <CardContent>
          <p className="text-muted-foreground">
            No cases found. Your cases will appear here.
          </p>
        </CardContent>
      </Card>
    </div>
  );
}
