import { Archive } from "lucide-react";

export default function ClosedAlignments() {
  return (
    <div className="p-4">
      <div className="flex items-center gap-2 mb-6">
        <Archive className="h-5 w-5 sm:h-6 sm:w-6 text-primary" />
        <h1 className="text-lg sm:text-2xl font-bold">Closed Alignments</h1>
      </div>
      
      <div className="text-muted-foreground text-center py-12">
        <p>Navodila za to stran boš dobil v nadaljevanju.</p>
      </div>
    </div>
  );
}
