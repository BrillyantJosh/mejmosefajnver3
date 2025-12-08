import { Separator } from "@/components/ui/separator";

export default function Info() {
  return (
    <div className="px-4 py-8 max-w-4xl mx-auto">
      <div className="text-center mb-12">
        <p className="text-primary uppercase tracking-[0.3em] text-sm font-medium mb-4">
          The Philosophy
        </p>
        <h1 className="text-4xl md:text-5xl font-serif font-normal text-foreground mb-6">
          One for All, All for One
        </h1>
        <Separator className="w-24 mx-auto" />
      </div>

      <div className="grid md:grid-cols-2 gap-12 md:gap-16">
        <div className="space-y-6">
          <h2 className="text-2xl font-serif text-primary">Beyond Voting</h2>
          <div className="space-y-4 text-muted-foreground leading-relaxed">
            <p>
              Traditional voting creates division. It splits communities into 
              winners and losers, majorities and minorities. Every vote cast is a 
              line drawn between "us" and "them."
            </p>
            <p>
              But what if there was another way? A way where no one loses, 
              because everyone finds common ground?
            </p>
          </div>
        </div>

        <div className="space-y-6">
          <h2 className="text-2xl font-serif text-primary">The Path of Alignment</h2>
          <div className="space-y-4 text-muted-foreground leading-relaxed">
            <p>
              Alignment is the ancient art of finding unity within diversity. 
              Instead of competing for dominance, we collaborate toward 
              harmony.
            </p>
            <p>
              When we align, we don't compromise our truth — we discover a 
              greater truth that encompasses all perspectives. This is the utopian 
              ideal made manifest.
            </p>
          </div>
        </div>
      </div>
    </div>
  );
}
