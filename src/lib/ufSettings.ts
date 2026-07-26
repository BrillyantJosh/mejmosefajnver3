/**
 * Unconditional Financing — admin-configurable module rules, client side.
 *
 * The server is authoritative (it derives funding_opens_at and rejects requests
 * over a group's cap); these values exist so the form and the article can show
 * the user exactly what will be applied, instead of a hardcoded "8 days".
 */
import type { UfRequestType } from "@/hooks/useUFData";

export const UF_DEFAULT_MATURING_DAYS = 8;

export type UfMaxAmounts = Record<UfRequestType, number>;

/** 0 = no cap. The module ships uncapped until an admin sets real limits. */
export const UF_DEFAULT_MAX_AMOUNTS: UfMaxAmounts = {
  personal_hardship: 0,
  lifestyle_transition: 0,
  wellbeing_project: 0,
};

/**
 * "8 dni" / "1 dan" / "2 dneva" — Slovenian needs the dual and the plural,
 * English only singular/plural.
 */
export function formatDays(days: number, sl: boolean): string {
  if (!sl) return `${days} ${days === 1 ? "day" : "days"}`;
  const mod100 = days % 100;
  const word =
    mod100 === 1 ? "dan" : mod100 === 2 ? "dneva" : mod100 === 3 || mod100 === 4 ? "dni" : "dni";
  return `${days} ${word}`;
}

/** Locative form used after "po …" — "po 8 dneh" / "po 1 dnevu". */
export function formatDaysAfter(days: number, sl: boolean): string {
  if (!sl) return `${days} ${days === 1 ? "day" : "days"}`;
  return `${days} ${days % 100 === 1 ? "dnevu" : "dneh"}`;
}
