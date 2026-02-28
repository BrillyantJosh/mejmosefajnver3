import { Outlet } from "react-router-dom";
import SubNavigation from "@/components/layout/SubNavigation";
import { FileWarning, ClipboardList } from "lucide-react";

const navItems = [
  { title: "Report", path: "/report-loss", icon: FileWarning },
  { title: "Board", path: "/report-loss/board", icon: ClipboardList },
];

export default function ReportLossLayout() {
  return (
    <div className="max-w-7xl mx-auto pb-20">
      <div className="mb-6">
        <h1 className="text-3xl font-bold">Report Loss</h1>
        <p className="text-muted-foreground">
          Report lost wallets and view the public loss board
        </p>
      </div>

      <Outlet />
      <SubNavigation items={navItems} variant="bottom" />
    </div>
  );
}
