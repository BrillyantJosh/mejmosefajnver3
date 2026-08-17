/**
 * The standard menu order is a promise to users ("it's the third item"), so
 * it is pinned here rather than left to whatever the registry happens to say.
 *   npx tsx scripts/testMenuOrder.ts
 */
import { readFileSync } from 'node:fs';
import { groupMenuModules, MENU_GROUP_CORE, MENU_GROUP_COMMUNITY } from '../src/lib/menuOrder.js';

/**
 * The registry imports image assets, so it cannot be imported outside Vite —
 * read the ids and enabled flags straight out of the source instead. Parsing
 * the real file keeps this test honest about what actually ships.
 */
function loadRegistry(): Array<{ id: string; enabled: boolean }> {
  const src = readFileSync(new URL('../src/contexts/ModulesContext.tsx', import.meta.url), 'utf8');
  const body = src.slice(src.indexOf('const DEFAULT_MODULES'), src.indexOf('\n];', src.indexOf('const DEFAULT_MODULES')));
  const out: Array<{ id: string; enabled: boolean }> = [];
  for (const block of body.split(/\n  \{/).slice(1)) {
    const id = /id: '([^']+)'/.exec(block)?.[1];
    if (!id) continue;
    out.push({ id, enabled: /enabled: true/.test(block) });
  }
  return out;
}
const DEFAULT_MODULES = loadRegistry();

let failures = 0;
const check = (name: string, cond: boolean, detail?: unknown) => {
  console.log(`  ${cond ? '✓' : '✗'} ${name}${cond ? '' : ' — ' + JSON.stringify(detail).slice(0, 200)}`);
  if (!cond) failures++;
};

const ids = (list: Array<{ id: string }>) => list.map((m) => m.id);

console.log('— the declared order —');
{
  const mods = [{ id: 'chat' }, { id: 'wallet' }, { id: 'lanadiscount' }, { id: 'plan15' }, { id: 'lana8wonder' }, { id: 'unconditionalpayment' }];
  const g = groupMenuModules(mods);
  check('group 2 in declared order, not input order',
    ids(g.core).join() === 'wallet,unconditionalpayment,lana8wonder,plan15', ids(g.core));
  check('group 3 in declared order',
    ids(g.community).join() === 'lanadiscount,chat', ids(g.community));
  check('nothing left over here', g.rest.length === 0, ids(g.rest));
}

console.log('— settings cannot reorder it —');
{
  // Same set, reversed: the registry's own order must not leak through.
  const forward = groupMenuModules(MENU_GROUP_CORE.map((id) => ({ id })));
  const reversed = groupMenuModules([...MENU_GROUP_CORE].reverse().map((id) => ({ id })));
  check('reversing the input changes nothing',
    ids(forward.core).join() === ids(reversed.core).join(), ids(reversed.core));
  check('and the result is the declared order',
    ids(reversed.core).join() === MENU_GROUP_CORE.join(), ids(reversed.core));
}

console.log('— nothing disappears —');
{
  const g = groupMenuModules(DEFAULT_MODULES);
  const shown = new Set([...ids(g.core), ...ids(g.community), ...ids(g.rest)]);
  const expected = new Set([
    ...DEFAULT_MODULES.filter((m) => m.enabled).map((m) => m.id),
    ...MENU_GROUP_CORE, ...MENU_GROUP_COMMUNITY,
  ]);
  check('every enabled module, plus every named one, appears exactly once',
    shown.size === expected.size && [...expected].every((id) => shown.has(id)),
    { expected: expected.size, shown: shown.size });
  const overlap = ids(g.rest).filter((id) => shown.has(id) && (MENU_GROUP_CORE.includes(id) || MENU_GROUP_COMMUNITY.includes(id)));
  check('the trailing group never repeats a named module', overlap.length === 0, overlap);
  check('the trailing group keeps the registry order',
    ids(g.rest).join() === ids(DEFAULT_MODULES.filter((m) => m.enabled && !MENU_GROUP_CORE.includes(m.id) && !MENU_GROUP_COMMUNITY.includes(m.id))).join());
}

console.log('— every named id exists in the registry —');
{
  const known = new Set(DEFAULT_MODULES.map((m) => m.id));
  for (const id of [...MENU_GROUP_CORE, ...MENU_GROUP_COMMUNITY]) {
    check(`"${id}" is a real module`, known.has(id as never));
  }
}

console.log('— settings cannot empty the standard groups —');
{
  // The reported case: this person's saved KIND 37334 carries
  // {"id":"Lana8Wonder","enabled":false}, which used to remove it from the menu.
  const g = groupMenuModules(DEFAULT_MODULES.map((m) => (m.id === 'lana8wonder' ? { ...m, enabled: false } : m)));
  check('a disabled named module still shows', ids(g.core).includes('lana8wonder'), ids(g.core));
  check('and keeps its place in the order',
    ids(g.core).join() === MENU_GROUP_CORE.join(), ids(g.core));
}
{
  // …while a disabled module OUTSIDE the named groups stays hidden.
  const g = groupMenuModules(DEFAULT_MODULES.map((m) => (m.id === 'own' ? { ...m, enabled: false } : m)));
  check('a disabled unnamed module stays hidden', !ids(g.rest).includes('own'), ids(g.rest));
}

console.log('— a module missing from the registry just closes the gap —');
{
  const withoutWallet = MENU_GROUP_CORE.filter((id) => id !== 'wallet').map((id) => ({ id }));
  const g = groupMenuModules(withoutWallet);
  check('no hole, no crash', ids(g.core).join() === 'unconditionalpayment,lana8wonder,plan15', ids(g.core));
}

console.log(failures ? `\n❌ ${failures} FAILED` : '\n✅ all passed');
process.exit(failures ? 1 : 0);
