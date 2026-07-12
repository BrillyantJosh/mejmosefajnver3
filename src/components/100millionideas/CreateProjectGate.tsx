import { Button } from "@/components/ui/button";
import { Sparkles, ArrowRight, HeartHandshake } from "lucide-react";
import type { SupportedLang } from "@/i18n/types";

/**
 * Intro / agreement step shown before the create-project form. The applicant
 * must confirm the basis for participation (Lana8Wonder membership + full
 * responsibility) and read what kind of projects crowdfunding encourages, then
 * confirm to open the form. Slovenian for `sl`, English for everything else.
 */

interface Focus { h: string; t: string }
interface Content {
  title: string;
  basisTitle: string;
  basis: string[];
  encourageIntro: string;
  point1Title: string;
  point1Body: string;
  point2Title: string;
  focusIntro: string;
  focus: Focus[];
  agree: string;
}

const SL: Content = {
  title: "Osnova za sodelovanje",
  basisTitle: "Osnova za sodelovanje:",
  basis: [
    "Vključenost v Lana8Wonder — tvoja dolgoročna zaveza k skupnemu obilju.",
    "Z oddajo projekta prevzemaš polno odgovornost za njegovo izvedbo.",
  ],
  encourageIntro: "S crowdfundingom spodbujamo predvsem projekte, ki pomenijo:",
  point1Title: "1. Dovoliti si majhen korak v novo smer",
  point1Body:
    "Projekt naj predstavlja tvoj naslednji korak, s katerim v svet prinašaš svojo edinstveno kreativnost, igrivost in pogum in ki je za dobro človeka in narave.",
  point2Title:
    "2. Doprinos k skupnosti: tvoja ideja podpira svet Lane in njegov razvoj, lokalno skupnost oz. naravo",
  focusIntro: "Trenutno še posebej spodbujamo projekte, ki se osredotočajo na:",
  focus: [
    { h: "Digitalna bitja", t: "ustvarjanje in integracija tvojega digitalnega sopotnika :)" },
    {
      h: "Nove Točke Obilja",
      t: "postavljanje lokalnih vozlišč za pretok oz. ponudbo eko pridelkov in izdelkov, aktivnosti in dogodkov, povezanih z Lano.",
    },
    {
      h: "Zaveza ponudnika za pot (od 5/10/15 %) do 20 %",
      t: "spodbuda za ponudnike izdelkov in storitev, da stopijo na pot najboljšega od najboljšega — ekološkega, naravnega, okolju in človeku prijaznega, ter nato inspirirajo druge k temu.",
    },
  ],
  agree: "Razumem in se strinjam",
};

const EN: Content = {
  title: "Basis for participation",
  basisTitle: "Basis for participation:",
  basis: [
    "Membership in Lana8Wonder — your long-term commitment to shared abundance.",
    "By submitting a project you take full responsibility for its realization.",
  ],
  encourageIntro: "Through crowdfunding we especially encourage projects that mean:",
  point1Title: "1. Allowing yourself a small step in a new direction",
  point1Body:
    "Let the project be your next step — bringing your unique creativity, playfulness and courage into the world, for the good of people and nature.",
  point2Title:
    "2. Contribution to the community: your idea supports the world of Lana and its development, the local community and nature",
  focusIntro: "Right now we especially encourage projects focused on:",
  focus: [
    { h: "Digital beings", t: "creating and integrating your digital companion :)" },
    {
      h: "New Points of Abundance",
      t: "setting up local hubs for the flow and offering of eco produce and products, activities and events connected with Lana.",
    },
    {
      h: "Provider's commitment to the path (from 5/10/15%) up to 20%",
      t: "an incentive for providers of products and services to step onto the path of the best of the best — ecological, natural, friendly to the environment and people — and then inspire others to do the same.",
    },
  ],
  agree: "I understand and agree",
};

export default function CreateProjectGate({ lang, onAgree }: { lang: SupportedLang; onAgree: () => void }) {
  const c = lang === "sl" ? SL : EN;
  return (
    <div className="rounded-xl border bg-card p-5 sm:p-7 space-y-5">
      {/* Basis for participation */}
      <div className="flex items-start gap-3">
        <div className="mt-0.5 flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-primary/10">
          <HeartHandshake className="h-5 w-5 text-primary" />
        </div>
        <div className="space-y-2">
          <h2 className="text-lg font-bold text-foreground">{c.basisTitle}</h2>
          <ul className="space-y-1.5">
            {c.basis.map((b, i) => (
              <li key={i} className="flex items-start gap-2 text-sm text-foreground">
                <span className="mt-2 h-1.5 w-1.5 shrink-0 rounded-full bg-primary" />
                <span className="leading-relaxed">{b}</span>
              </li>
            ))}
          </ul>
        </div>
      </div>

      <div className="border-t pt-5 space-y-4">
        <p className="text-sm font-medium text-foreground flex items-center gap-2">
          <Sparkles className="h-4 w-4 text-primary shrink-0" />
          {c.encourageIntro}
        </p>

        {/* Point 1 */}
        <div className="rounded-lg bg-muted/40 border px-4 py-3">
          <p className="font-semibold text-foreground text-sm">{c.point1Title}</p>
          <p className="mt-1 text-sm text-muted-foreground leading-relaxed">{c.point1Body}</p>
        </div>

        {/* Point 2 + focus list */}
        <div className="rounded-lg bg-muted/40 border px-4 py-3 space-y-3">
          <p className="font-semibold text-foreground text-sm leading-relaxed">{c.point2Title}</p>
          <p className="text-sm text-muted-foreground">{c.focusIntro}</p>
          <ul className="space-y-2.5">
            {c.focus.map((f, i) => (
              <li key={i} className="flex items-start gap-2.5 text-sm">
                <span className="mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-primary/10 text-[11px] font-bold text-primary">
                  {i + 1}
                </span>
                <span className="leading-relaxed">
                  <span className="font-medium text-foreground">{f.h}: </span>
                  <span className="text-muted-foreground">{f.t}</span>
                </span>
              </li>
            ))}
          </ul>
        </div>
      </div>

      <Button size="lg" className="w-full" onClick={onAgree}>
        {c.agree}
        <ArrowRight className="ml-2 h-4 w-4" />
      </Button>
    </div>
  );
}
