import { Outlet } from "react-router-dom";
import SubNavigation from "@/components/layout/SubNavigation";
import { Users, User, Wallet } from "lucide-react";
import { useSystemParameters } from "@/contexts/SystemParametersContext";
import { Card, CardContent } from "@/components/ui/card";

const navItems = [
  { title: "Sledilci", path: "/plan15", icon: Users },
  { title: "Moj PLAN15", path: "/plan15/me", icon: User },
  { title: "Za poplačati", path: "/plan15/payouts", icon: Wallet },
];

export default function Plan15Layout() {
  const { parameters } = useSystemParameters();
  const floor = parameters?.plan15Floor || 0;
  const priceEur = parameters?.plan15Price?.EUR || 0;

  return (
    <div className="max-w-7xl mx-auto pb-24 px-4 sm:px-6">
      <div className="mb-4">
        <h1 className="text-2xl sm:text-3xl font-bold">PLAN15</h1>
        <p className="text-sm sm:text-base text-muted-foreground">
          Kupuj in preprodajaj neregistrirane LANE — do 1 MIO, nato postopno drobljenje
        </p>
      </div>

      <Card className="mb-4">
        <CardContent className="p-3 sm:p-4 flex flex-wrap items-center gap-x-6 gap-y-2 text-sm">
          <div>
            <span className="text-muted-foreground">Prag zadržanja: </span>
            <span className="font-semibold">{floor ? floor.toLocaleString("en-US") + " LANA" : "ni objavljen"}</span>
          </div>
          <div>
            <span className="text-muted-foreground">Odkupna cena: </span>
            <span className="font-semibold">{priceEur ? priceEur + " EUR / LANA" : "ni objavljena"}</span>
          </div>
        </CardContent>
      </Card>

      {(!floor || !priceEur) && (
        <Card className="mb-6 border-yellow-300 dark:border-yellow-800 bg-yellow-50 dark:bg-yellow-950/30">
          <CardContent className="p-3 text-sm text-yellow-800 dark:text-yellow-300">
            ⚠️ PLAN15 parametri (prag / cena) še niso objavljeni v KIND 38888. Objava ponudb je smiselna šele, ko so parametri nastavljeni.
          </CardContent>
        </Card>
      )}

      <Outlet />

      <SubNavigation items={navItems} variant="bottom" />
    </div>
  );
}
