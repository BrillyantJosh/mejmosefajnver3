import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { MapPin } from "lucide-react";

export default function LiveEvents() {
  return (
    <div className="space-y-4 px-4">
      <div className="flex items-center gap-2 mb-6">
        <MapPin className="h-6 w-6 text-primary" />
        <h1 className="text-2xl font-bold">Live Events</h1>
      </div>
      
      <Card>
        <CardHeader>
          <CardTitle className="text-lg">Coming Soon</CardTitle>
        </CardHeader>
        <CardContent>
          <p className="text-muted-foreground">
            Physical events will be displayed here. Add your first event!
          </p>
        </CardContent>
      </Card>
    </div>
  );
}
