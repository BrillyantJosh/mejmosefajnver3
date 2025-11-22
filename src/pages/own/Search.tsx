import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Search as SearchIcon } from "lucide-react";

export default function Search() {
  return (
    <div className="space-y-6">
      <Card>
        <CardHeader>
          <CardTitle>Search</CardTitle>
          <CardDescription>
            Search for cases and responsibilities
          </CardDescription>
        </CardHeader>
        <CardContent>
          <div className="relative">
            <SearchIcon className="absolute left-3 top-3 h-4 w-4 text-muted-foreground" />
            <Input 
              placeholder="Search cases..." 
              className="pl-10"
            />
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
