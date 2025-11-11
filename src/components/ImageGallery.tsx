import { useState } from "react";
import { Dialog, DialogContent } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { ChevronLeft, ChevronRight, X, Download } from "lucide-react";

interface ImageGalleryProps {
  urls: string[];
  isOwn?: boolean;
}

export function ImageGallery({ urls, isOwn = false }: ImageGalleryProps) {
  const [selectedIndex, setSelectedIndex] = useState<number | null>(null);

  const openLightbox = (index: number) => {
    setSelectedIndex(index);
  };

  const closeLightbox = () => {
    setSelectedIndex(null);
  };

  const goToPrevious = () => {
    if (selectedIndex !== null && selectedIndex > 0) {
      setSelectedIndex(selectedIndex - 1);
    }
  };

  const goToNext = () => {
    if (selectedIndex !== null && selectedIndex < urls.length - 1) {
      setSelectedIndex(selectedIndex + 1);
    }
  };

  const handleDownload = async () => {
    if (selectedIndex === null) return;
    
    const url = urls[selectedIndex];
    try {
      const response = await fetch(url);
      const blob = await response.blob();
      const downloadUrl = window.URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = downloadUrl;
      link.download = `image-${selectedIndex + 1}.jpg`;
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
      window.URL.revokeObjectURL(downloadUrl);
    } catch (error) {
      console.error('Error downloading image:', error);
    }
  };

  const getGridCols = () => {
    if (urls.length === 1) return 'grid-cols-1';
    if (urls.length === 2) return 'grid-cols-2';
    if (urls.length <= 4) return 'grid-cols-2';
    return 'grid-cols-3';
  };

  return (
    <>
      <div className={`grid gap-1 ${getGridCols()} w-full max-w-full overflow-hidden`}>
        {urls.map((url, index) => (
          <div
            key={index}
            className="relative aspect-square cursor-pointer group overflow-hidden rounded-lg border border-border/50"
            onClick={() => openLightbox(index)}
          >
            <img
              src={url}
              alt={`Image ${index + 1}`}
              className="w-full h-full object-cover transition-transform group-hover:scale-105"
              loading="lazy"
            />
            {urls.length > 1 && (
              <div className="absolute bottom-2 right-2 bg-black/60 text-white text-xs px-2 py-1 rounded">
                {index + 1}/{urls.length}
              </div>
            )}
          </div>
        ))}
      </div>

      <Dialog open={selectedIndex !== null} onOpenChange={(open) => !open && closeLightbox()}>
        <DialogContent className="max-w-[95vw] max-h-[95vh] p-0 bg-black/95 border-0">
          <div className="relative w-full h-full flex items-center justify-center">
            {selectedIndex !== null && (
              <>
                <img
                  src={urls[selectedIndex]}
                  alt={`Image ${selectedIndex + 1}`}
                  className="max-w-full max-h-[90vh] object-contain"
                />

                <div className="absolute top-4 right-4 flex gap-2">
                  <Button
                    variant="ghost"
                    size="icon"
                    onClick={handleDownload}
                    className="bg-black/60 hover:bg-black/80 text-white"
                  >
                    <Download className="h-5 w-5" />
                  </Button>
                  <Button
                    variant="ghost"
                    size="icon"
                    onClick={closeLightbox}
                    className="bg-black/60 hover:bg-black/80 text-white"
                  >
                    <X className="h-5 w-5" />
                  </Button>
                </div>

                <div className="absolute bottom-4 left-1/2 transform -translate-x-1/2 bg-black/60 text-white px-4 py-2 rounded-full text-sm">
                  {selectedIndex + 1} / {urls.length}
                </div>

                {urls.length > 1 && (
                  <>
                    {selectedIndex > 0 && (
                      <Button
                        variant="ghost"
                        size="icon"
                        onClick={goToPrevious}
                        className="absolute left-4 top-1/2 transform -translate-y-1/2 bg-black/60 hover:bg-black/80 text-white"
                      >
                        <ChevronLeft className="h-6 w-6" />
                      </Button>
                    )}

                    {selectedIndex < urls.length - 1 && (
                      <Button
                        variant="ghost"
                        size="icon"
                        onClick={goToNext}
                        className="absolute right-4 top-1/2 transform -translate-y-1/2 bg-black/60 hover:bg-black/80 text-white"
                      >
                        <ChevronRight className="h-6 w-6" />
                      </Button>
                    )}
                  </>
                )}
              </>
            )}
          </div>
        </DialogContent>
      </Dialog>
    </>
  );
}
