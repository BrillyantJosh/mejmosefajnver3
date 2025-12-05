import { useParams, useNavigate } from "react-router-dom";
import { Button } from "@/components/ui/button";
import { ArrowLeft } from "lucide-react";
import Feed from "./Feed";

export default function RoomFeed() {
  const { roomSlug } = useParams<{ roomSlug: string }>();
  const navigate = useNavigate();

  return (
    <div>
      {/* Back button and room title */}
      <div className="flex items-center gap-3 mb-4">
        <Button 
          variant="ghost" 
          size="icon"
          onClick={() => navigate('/social/home')}
        >
          <ArrowLeft className="h-5 w-5" />
        </Button>
        <h1 className="text-xl font-bold">
          {roomSlug ? `Room: ${roomSlug}` : 'Feed'}
        </h1>
      </div>
      
      {/* Use Feed component with room filter pre-applied */}
      <Feed roomFilter={roomSlug} />
    </div>
  );
}
