import { useEffect } from "react";
import { ThemeColors } from "@/types/admin";

/**
 * Convert a hex color (#RRGGBB or #RGB) to HSL space-separated values
 * e.g. "#8B5CF6" → "262 83% 66%"
 * Tailwind/shadcn expects CSS variables in this format (without hsl() wrapper)
 */
function hexToHsl(hex: string): string {
  // Remove # if present
  hex = hex.replace(/^#/, '');

  // Expand shorthand (#RGB → #RRGGBB)
  if (hex.length === 3) {
    hex = hex[0] + hex[0] + hex[1] + hex[1] + hex[2] + hex[2];
  }

  const r = parseInt(hex.substring(0, 2), 16) / 255;
  const g = parseInt(hex.substring(2, 4), 16) / 255;
  const b = parseInt(hex.substring(4, 6), 16) / 255;

  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const l = (max + min) / 2;

  if (max === min) {
    // Achromatic
    return `0 0% ${Math.round(l * 100)}%`;
  }

  const d = max - min;
  const s = l > 0.5 ? d / (2 - max - min) : d / (max + min);

  let h = 0;
  if (max === r) {
    h = ((g - b) / d + (g < b ? 6 : 0)) / 6;
  } else if (max === g) {
    h = ((b - r) / d + 2) / 6;
  } else {
    h = ((r - g) / d + 4) / 6;
  }

  return `${Math.round(h * 360)} ${Math.round(s * 100)}% ${Math.round(l * 100)}%`;
}

/**
 * Check if a value looks like a hex color
 */
function isHexColor(value: string): boolean {
  return /^#([0-9A-Fa-f]{3}|[0-9A-Fa-f]{6})$/.test(value.trim());
}

export const useTheme = (colors: ThemeColors | null) => {
  useEffect(() => {
    if (!colors) return;

    const root = document.documentElement;
    Object.entries(colors).forEach(([key, value]) => {
      // Convert hex colors to HSL format for Tailwind compatibility
      // Tailwind uses hsl(var(--primary)) so the variable must be HSL values
      const cssValue = isHexColor(value) ? hexToHsl(value) : value;
      root.style.setProperty(`--${key.replace(/_/g, '-')}`, cssValue);
    });
  }, [colors]);
};
