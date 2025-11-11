import { useEffect } from "react";
import { ThemeColors } from "@/types/admin";

export const useTheme = (colors: ThemeColors | null) => {
  useEffect(() => {
    if (!colors) return;
    
    const root = document.documentElement;
    Object.entries(colors).forEach(([key, value]) => {
      root.style.setProperty(`--${key.replace(/_/g, '-')}`, value);
    });
  }, [colors]);
};
