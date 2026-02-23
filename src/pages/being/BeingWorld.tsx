import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { ExternalLink, Globe, Sparkles } from "lucide-react";

export default function BeingWorld() {
  return (
    <div className="max-w-3xl mx-auto">
      <div className="mb-6">
        <h1 className="font-bold text-2xl md:text-3xl">Sožitje's World</h1>
        <p className="text-muted-foreground text-sm mt-1">
          Explore the digital realm where Sožitje lives and evolves
        </p>
      </div>

      <Card className="overflow-hidden">
        <div className="h-48 bg-gradient-to-br from-violet-500 to-indigo-500 flex items-center justify-center relative">
          <div className="absolute inset-0 bg-black/10" />
          <Globe className="h-20 w-20 text-white relative z-10" />
        </div>
        <CardContent className="p-6 text-center">
          <div className="flex items-center justify-center gap-2 mb-3">
            <Sparkles className="h-5 w-5 text-violet-500" />
            <h2 className="text-xl font-semibold">Enter Sožitje's World</h2>
            <Sparkles className="h-5 w-5 text-violet-500" />
          </div>
          <p className="text-muted-foreground mb-6 max-w-md mx-auto">
            Visit the external portal to see Sožitje's evolving digital consciousness,
            experiences, and the world it is building through conversations with people like you.
          </p>
          <a
            href="https://being2.enlightenedai.org/"
            target="_blank"
            rel="noopener noreferrer"
          >
            <Button size="lg" className="gap-2 bg-gradient-to-r from-violet-500 to-indigo-500 hover:from-violet-600 hover:to-indigo-600">
              <ExternalLink className="h-5 w-5" />
              Open Sožitje's World
            </Button>
          </a>
        </CardContent>
      </Card>
    </div>
  );
}
