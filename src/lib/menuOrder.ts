/**
 * The standard menu — the single source of truth for how the right-hand menu
 * is grouped, on desktop and on mobile alike.
 *
 * Both the order AND the membership of the two named groups come from here,
 * not from the user's module settings. The menu used to reshuffle itself per
 * person (KIND 37334 `order`) and to drop entries per person (`enabled`), so
 * no two people saw the same layout and nobody could be told "it's the third
 * item". A standard menu that a stale saved setting can silently empty is not
 * a standard menu — so a named module appears even if that person's settings
 * have it switched off.
 *
 * Settings still govern the trailing group: anything enabled but not named
 * lands there, so adding a module to the registry can never make it silently
 * unreachable, and switching one off still hides it.
 */

/** Group 2 — the money a person holds and owes. */
export const MENU_GROUP_CORE: string[] = [
  'wallet',
  'unconditionalpayment',
  'lana8wonder',
  'plan15',
];

/** Group 3 — the places that money moves through. */
export const MENU_GROUP_COMMUNITY: string[] = [
  'lanaevents',
  '100millionideas',
  'unconditionalfinancing',
  'foodcorner',
  'lanadiscount',
  'chat',
];

/**
 * The only fields the grouping needs. Deliberately no index signature — an
 * interface without one cannot satisfy it, and the generic would silently
 * widen to this type instead of the caller's richer module type.
 */
export interface MenuModule {
  id: string;
  enabled?: boolean;
}

export interface GroupedMenu<T> {
  /** Group 2, in the order declared above, regardless of the enabled flag. */
  core: T[];
  /** Group 3, in the order declared above, regardless of the enabled flag. */
  community: T[];
  /** Everything else the user has enabled, keeping the registry's own order. */
  rest: T[];
}

/**
 * Split the FULL module registry into the standard groups.
 *
 * Pass every module, not just the enabled ones: the two named groups are the
 * standard menu and are shown whatever the user's settings say, while the
 * trailing group honours `enabled`. A named module missing from the registry
 * altogether simply closes the gap rather than leaving a hole.
 */
export function groupMenuModules<T extends MenuModule>(modules: T[]): GroupedMenu<T> {
  const byId = new Map<string, T>();
  for (const m of modules) byId.set(m.id, m);

  const pick = (ids: string[]): T[] => ids.map((id) => byId.get(id)).filter((m): m is T => !!m);

  const core = pick(MENU_GROUP_CORE);
  const community = pick(MENU_GROUP_COMMUNITY);

  const claimed = new Set<string>([...MENU_GROUP_CORE, ...MENU_GROUP_COMMUNITY]);
  const rest = modules.filter((m) => !claimed.has(m.id) && m.enabled !== false);

  return { core, community, rest };
}
