import { useEffect, useMemo, useRef, useState } from "react";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";
import { COUNTRIES, countryByCode, type Country } from "@/lib/bef/vendor/server/lib/countries.ts";
import { flagEmoji } from "@/lib/bef/vendor/src/lib/format.ts";

/**
 * Country field for BEF's registration card, backed by the ISO 3166-1 list BEF
 * checks the profile with: type a few letters, pick the country, and the code
 * travels with it. Names show in the reader's language and a search matches
 * either the local or the English name. Withdrawn codes (YU, SU, DD…) are left
 * out, so nobody can publish one as their country.
 *
 * Ported from bef-explorer src/components/CountryPicker.tsx (currentOnly).
 */

/** Codes that no longer name a country, kept in the list for old records. */
const WITHDRAWN = new Set(["AN", "BU", "CQ", "CS", "DD", "DY", "FX", "HV", "NH", "RH", "SU", "TP", "UK", "VD", "YD", "YU", "ZR"]);

function regionNames(locale: string): ((code: string) => string | undefined) | null {
  try {
    const names = new Intl.DisplayNames([locale], { type: "region" });
    return (code) => {
      try {
        return names.of(code);
      } catch {
        return undefined;
      }
    };
  } catch {
    return null;
  }
}

export function BefCountryPicker({
  code,
  onChange,
  locale,
  placeholder,
  noMatch,
  inputId,
  invalid = false,
  disabled = false,
}: {
  code: string | null;
  onChange: (code: string | null) => void;
  locale: string;
  placeholder: string;
  noMatch: (query: string) => string;
  inputId?: string;
  invalid?: boolean;
  disabled?: boolean;
}) {
  const localName = useMemo(() => regionNames(locale), [locale]);
  const nameOf = (country: Country | null): string => (country ? (localName?.(country.code) ?? country.name) : "");
  const selected = countryByCode(code);
  const [query, setQuery] = useState(nameOf(selected));
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(0);
  const box = useRef<HTMLDivElement>(null);

  // Follow the chosen code when the language changes.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => setQuery(nameOf(countryByCode(code))), [code, localName]);

  useEffect(() => {
    const away = (e: MouseEvent) => {
      if (box.current && !box.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", away);
    return () => document.removeEventListener("mousedown", away);
  }, []);

  const matches = useMemo(() => {
    const q = query.trim().toLocaleLowerCase(locale);
    const pool = COUNTRIES.filter((c) => !WITHDRAWN.has(c.code));
    if (!q) return pool.slice(0, 8);
    const starts: Country[] = [];
    const contains: Country[] = [];
    for (const c of pool) {
      const names = [c.name.toLowerCase(), (localName?.(c.code) ?? "").toLocaleLowerCase(locale)];
      if (names.some((n) => n.startsWith(q)) || c.code.toLowerCase() === q) starts.push(c);
      else if (names.some((n) => n.includes(q))) contains.push(c);
    }
    return [...starts, ...contains].slice(0, 8);
  }, [query, localName, locale]);

  const choose = (isoCode: string) => {
    onChange(isoCode);
    setQuery(nameOf(countryByCode(isoCode)));
    setOpen(false);
  };

  return (
    <div className="relative" ref={box}>
      <Input
        id={inputId}
        type="text"
        value={query}
        placeholder={placeholder}
        autoComplete="off"
        aria-invalid={invalid || undefined}
        className={cn(selected && "pr-16", invalid && "border-destructive")}
        disabled={disabled}
        onFocus={() => setOpen(true)}
        onChange={(e) => {
          setQuery(e.target.value);
          setActive(0);
          setOpen(true);
          // Half a country name is not a country: the code is cleared until one is chosen.
          if (nameOf(countryByCode(code)) !== e.target.value) onChange(null);
        }}
        onKeyDown={(e) => {
          if (!open) return;
          if (e.key === "ArrowDown") {
            e.preventDefault();
            setActive((i) => Math.min(i + 1, matches.length - 1));
          } else if (e.key === "ArrowUp") {
            e.preventDefault();
            setActive((i) => Math.max(i - 1, 0));
          } else if (e.key === "Enter" && matches[active]) {
            e.preventDefault();
            choose(matches[active].code);
          } else if (e.key === "Escape") setOpen(false);
        }}
      />
      {selected && (
        <span className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-xs text-muted-foreground">
          {flagEmoji(selected.code)} {selected.code}
        </span>
      )}
      {open && !disabled && (
        <ul className="absolute z-20 mt-1 max-h-64 w-full overflow-y-auto rounded-lg border border-border bg-popover py-1 text-sm shadow-md">
          {matches.length === 0 ? (
            <li className="px-3 py-2 text-muted-foreground">{noMatch(query)}</li>
          ) : (
            matches.map((c, i) => (
              <li
                key={c.code}
                className={cn("flex cursor-pointer items-center justify-between gap-2 px-3 py-2", i === active && "bg-accent text-accent-foreground")}
                onMouseEnter={() => setActive(i)}
                onMouseDown={(e) => {
                  e.preventDefault();
                  choose(c.code);
                }}
              >
                <span>
                  {flagEmoji(c.code)} {nameOf(c)}
                </span>
                <span className="text-xs text-muted-foreground">{c.code}</span>
              </li>
            ))
          )}
        </ul>
      )}
    </div>
  );
}
