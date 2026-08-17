/**
 * The standard menu order — the single source of truth for how the right-hand
 * menu is grouped, on desktop and on mobile alike.
 *
 * The ORDER here is fixed in code and deliberately NOT read from the user's
 * module settings: the menu used to reshuffle itself per person (KIND 37334
 * `order`), so no two people saw the same layout and nobody could be told
 * "it's the third item". Settings still decide what is VISIBLE — a module the
 * user switched off stays off — they just no longer decide the sequence.
 *
 * Anything enabled but not named in a group lands in the trailing group, so
 * adding a module to the registry can never make it silently unreachable.
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
 * The only field the grouping needs. Deliberately no index signature — an
 * interface without one cannot satisfy it, and the generic would silently
 * widen to this type instead of the caller's richer module type.
 */
export interface MenuModule {
  id: string;
}

export interface GroupedMenu<T> {
  /** Group 2, in the order declared above. */
  core: T[];
  /** Group 3, in the order declared above. */
  community: T[];
  /** Everything else that is enabled, keeping the registry's own order. */
  rest: T[];
}

/**
 * Split enabled modules into the standard groups.
 *
 * `modules` is expected to be the already-enabled set. A module named in a
 * group but absent (or switched off) simply does not appear — the group
 * closes up rather than leaving a hole.
 */
export function groupMenuModules<T extends MenuModule>(modules: T[]): GroupedMenu<T> {
  const byId = new Map<string, T>();
  for (const m of modules) byId.set(m.id, m);

  const pick = (ids: string[]): T[] => ids.map((id) => byId.get(id)).filter((m): m is T => !!m);

  const core = pick(MENU_GROUP_CORE);
  const community = pick(MENU_GROUP_COMMUNITY);

  const claimed = new Set<string>([...MENU_GROUP_CORE, ...MENU_GROUP_COMMUNITY]);
  const rest = modules.filter((m) => !claimed.has(m.id));

  return { core, community, rest };
}
