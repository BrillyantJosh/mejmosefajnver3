import {
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
} from "@/components/ui/accordion";
import { PlayCircle } from "lucide-react";

const videos = [
  {
    id: "registrar",
    question: "How to use Registrar?",
    youtubeId: "kBi4MKcc4qM",
  },
  {
    id: "tax-report",
    question: "How to Get TAX report for Lana to FIAT exchange?",
    youtubeId: "ienYy-ve53E",
  },
];

export default function VideoInstructions() {
  return (
    <div className="max-w-4xl mx-auto px-4 py-8">
      <div className="mb-6">
        <h1 className="text-3xl font-bold mb-2">Video Instructions</h1>
        <p className="text-muted-foreground">
          Click a question to watch the video tutorial
        </p>
      </div>

      <Accordion type="single" collapsible className="space-y-2">
        {videos.map((video) => (
          <AccordionItem
            key={video.id}
            value={video.id}
            className="border rounded-lg px-4"
          >
            <AccordionTrigger className="text-left">
              <div className="flex items-center gap-3">
                <PlayCircle className="h-5 w-5 text-red-500 shrink-0" />
                <span>{video.question}</span>
              </div>
            </AccordionTrigger>
            <AccordionContent>
              <div className="aspect-video rounded-lg overflow-hidden">
                <iframe
                  src={`https://www.youtube.com/embed/${video.youtubeId}`}
                  title={video.question}
                  allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture"
                  allowFullScreen
                  className="w-full h-full"
                />
              </div>
            </AccordionContent>
          </AccordionItem>
        ))}
      </Accordion>
    </div>
  );
}
