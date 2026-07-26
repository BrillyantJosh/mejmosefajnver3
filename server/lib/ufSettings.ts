/**
 * Unconditional Financing — admin-configurable module settings.
 *
 * Single source of truth for the REST route AND the relay indexer, so a request
 * arriving through either path gets the same maturing window and the same
 * per-group amount cap. Values live in app_settings (publicly readable, written
 * only through the admin update-app-settings function).
 *
 * Changing the maturing length only affects requests published afterwards:
 * funding_opens_at is written once, at first insert, and edits never move it.
 */
import { getDb } from '../db/connection.js';

export const UF_DEFAULT_MATURING_DAYS = 8;

export type UfRequestType =
  | 'personal_hardship'
  | 'lifestyle_transition'
  | 'wellbeing_project';

export type UfMaxAmounts = Record<UfRequestType, number>;

/** 0 means "no cap" — the module ships uncapped until an admin sets real limits. */
export const UF_DEFAULT_MAX_AMOUNTS: UfMaxAmounts = {
  personal_hardship: 0,
  lifestyle_transition: 0,
  wellbeing_project: 0,
};

export interface UfSettings {
  maturingDays: number;
  maturingSeconds: number;
  maxAmounts: UfMaxAmounts;
}

function readSetting(key: string): unknown {
  try {
    const row = getDb().prepare('SELECT value FROM app_settings WHERE key = ?').get(key) as any;
    if (!row?.value) return undefined;
    try { return JSON.parse(row.value); } catch { return row.value; }
  } catch {
    return undefined;
  }
}

/** A positive whole number of days; anything else falls back to the default. */
function sanitizeDays(raw: unknown): number {
  const n = typeof raw === 'string' ? parseInt(raw, 10) : Number(raw);
  if (!Number.isFinite(n)) return UF_DEFAULT_MATURING_DAYS;
  const days = Math.floor(n);
  if (days < 0) return UF_DEFAULT_MATURING_DAYS;
  // 0 days = funding opens immediately, which is a legitimate admin choice.
  return Math.min(days, 365);
}

/** A non-negative cap per group; 0 (or anything unparseable) means no cap. */
function sanitizeAmount(raw: unknown): number {
  const n = typeof raw === 'string' ? parseFloat(raw) : Number(raw);
  if (!Number.isFinite(n) || n <= 0) return 0;
  return n;
}

export function getUfSettings(): UfSettings {
  const maturingDays = sanitizeDays(readSetting('unconditional_financing_maturing_days'));
  const stored = readSetting('unconditional_financing_max_amounts') as Partial<UfMaxAmounts> | undefined;
  const maxAmounts: UfMaxAmounts = {
    personal_hardship: sanitizeAmount(stored?.personal_hardship),
    lifestyle_transition: sanitizeAmount(stored?.lifestyle_transition),
    wellbeing_project: sanitizeAmount(stored?.wellbeing_project),
  };
  return { maturingDays, maturingSeconds: maturingDays * 86400, maxAmounts };
}

/** The cap for one group, or 0 when that group is uncapped. */
export function maxAmountFor(type: string, settings: UfSettings): number {
  const key = type as UfRequestType;
  return settings.maxAmounts[key] ?? 0;
}
