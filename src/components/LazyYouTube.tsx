import { useState } from "react";
import { Play } from "lucide-react";

interface LazyYouTubeProps {
  videoId: string;
  title: string;
  className?: string;
}

export default function LazyYouTube({ videoId, title, className }: LazyYouTubeProps) {
  const [loaded, setLoaded] = useState(false);

  if (loaded) {
    return (
      <div className={className || "relative w-full"} style={{ paddingBottom: "56.25%" }}>
        <iframe
          className="absolute top-0 left-0 w-full h-full"
          src={`https://www.youtube.com/embed/${videoId}?autoplay=1`}
          title={title}
          allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture"
          allowFullScreen
        />
      </div>
    );
  }

  return (
    <button
      type="button"
      onClick={() => setLoaded(true)}
      className={`${className || "relative w-full"} group cursor-pointer`}
      style={{ paddingBottom: "56.25%" }}
      aria-label={`Play ${title}`}
    >
      <img
        src={`https://img.youtube.com/vi/${videoId}/hqdefault.jpg`}
        alt={title}
        className="absolute top-0 left-0 w-full h-full object-cover"
        loading="lazy"
      />
      <div className="absolute inset-0 flex items-center justify-center bg-black/20 group-hover:bg-black/30 transition-colors">
        <div className="h-14 w-14 rounded-full bg-red-600 flex items-center justify-center shadow-lg group-hover:scale-110 transition-transform">
          <Play className="h-7 w-7 text-white ml-1" fill="white" />
        </div>
      </div>
    </button>
  );
}
