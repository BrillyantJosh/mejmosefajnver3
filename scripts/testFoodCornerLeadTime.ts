/**
 * "Rok dobave" in Točka obilja: which weekly cycle an order lands in.
 *   npx tsx scripts/testFoodCornerLeadTime.ts
 *
 * Every list (Točka, supplier, their 36603/36604) filters orders by one moment:
 * when the order was placed, moved as many weeks later as its lead time. If
 * that moment drifts by a single day around midnight or a DST change, a
 * product is counted in the wrong week and a supplier's delivery looks short.
 * being3 runs the same vectors against its own copy of these functions.
 */
process.env.TZ = 'Europe/Ljubljana';

import { readFileSync } from 'node:fs';
import {
  addFoodCornerWeeks,
  foodCornerOrderCycleTime,
  foodCornerOrderInWeek,
  foodCornerMinWeekOffset,
  foodCornerWeekOffsetOf,
  foodCornerWeekRange,
  groupFoodCornerCheckout,
  groupFoodCornerOrdersByCycle,
  parseLeadTimeWeeks,
  slovenianPluralForm,
} from '../src/lib/foodCorner.js';

type Vectors = {
  parseLeadTimeWeeks: [unknown, number][];
  addWeeks: { from: string; weeks: number; local: string }[];
  cycleOffset: { why: string; now: string; anchor: string; placed: string; lead: number; offset: number }[];
};
const vectors: Vectors = JSON.parse(readFileSync(new URL('./foodCornerLeadTime.vectors.json', import.meta.url), 'utf8'));

let failures = 0;
const check = (name: string, cond: boolean, detail?: unknown) => {
  console.log(`  ${cond ? '✓' : '✗'} ${name}${cond ? '' : ' — ' + JSON.stringify(detail)}`);
  if (!cond) failures++;
};
const pad = (n: number) => String(n).padStart(2, '0');
const localText = (d: Date) =>
  `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`;

check('runs in Europe/Ljubljana', new Date('2026-07-01T12:00:00Z').getHours() === 14);

console.log('— reading the tag —');
for (const [raw, want] of vectors.parseLeadTimeWeeks) {
  const got = parseLeadTimeWeeks(raw);
  check(`${JSON.stringify(raw)} → ${want}`, got === want, got);
}

console.log('— moving a date by weeks —');
for (const v of vectors.addWeeks) {
  const got = localText(addFoodCornerWeeks(new Date(v.from), v.weeks));
  check(`${v.from} + ${v.weeks} weeks = ${v.local}`, got === v.local, got);
}

console.log('— which cycle an order belongs to —');
for (const v of vectors.cycleOffset) {
  const now = new Date(v.now);
  const order = { createdAt: Math.floor(new Date(v.placed).getTime() / 1000), leadTimeWeeks: v.lead };
  const offset = foodCornerWeekOffsetOf(foodCornerOrderCycleTime(order), v.anchor, now);
  check(`${v.why}: offset ${v.offset}`, offset === v.offset, offset);
  const inWeek = foodCornerOrderInWeek(order, foodCornerWeekRange(v.offset, v.anchor, now));
  const inBefore = foodCornerOrderInWeek(order, foodCornerWeekRange(v.offset + 1, v.anchor, now));
  const inAfter = foodCornerOrderInWeek(order, foodCornerWeekRange(v.offset - 1, v.anchor, now));
  check(`${v.why}: in that week and no other`, inWeek && !inBefore && !inAfter, { inWeek, inBefore, inAfter });
}

console.log('— an order without the tag is untouched —');
{
  const createdAt = Math.floor(new Date('2026-09-07T14:21:00+02:00').getTime() / 1000);
  check('no leadTimeWeeks = created_at', foodCornerOrderCycleTime({ createdAt }) === createdAt * 1000);
  check('lead 0 = created_at', foodCornerOrderCycleTime({ createdAt, leadTimeWeeks: 0 }) === createdAt * 1000);
}

console.log('— how far forward the pagers may go —');
{
  const now = new Date('2026-09-15T10:00:00+02:00');
  const at = (iso: string, leadTimeWeeks = 0) => ({ createdAt: Math.floor(new Date(iso).getTime() / 1000), leadTimeWeeks });
  check('no orders → 0', foodCornerMinWeekOffset([], 'thursday', now) === 0);
  check('only past and current orders → 0', foodCornerMinWeekOffset([at('2026-09-01T10:00:00+02:00'), at('2026-09-15T09:00:00+02:00')], 'thursday', now) === 0);
  const got = foodCornerMinWeekOffset([at('2026-09-15T09:00:00+02:00'), at('2026-09-14T09:00:00+02:00', 2), at('2026-09-03T09:00:00+02:00', 3)], 'thursday', now);
  check('latest lead cycle wins → -2', got === -2, got);
}

console.log('— "Po dobavi": selected cycle and every later one —');
{
  const now = new Date('2026-09-15T10:00:00+02:00');
  const at = (id: string, iso: string, leadTimeWeeks = 0) => ({ id, createdAt: Math.floor(new Date(iso).getTime() / 1000), leadTimeWeeks });
  const orders = [
    at('past', '2026-09-07T14:21:00+02:00'), // offset 1
    at('now', '2026-09-15T10:00:00+02:00'), // offset 0
    at('lead2', '2026-09-15T10:00:00+02:00', 2), // offset -2
    at('lead1', '2026-09-11T10:00:00+02:00', 1), // offset -1
    at('now2', '2026-09-10T00:00:00+02:00'), // offset 0
  ];
  const cycles = groupFoodCornerOrdersByCycle(orders, 0, 'thursday', now);
  const shape = cycles.map((c) => `${c.offset}:${c.orders.map((o) => o.id).join(',')}`).join(' | ');
  check('soonest first, past cycle left out', shape === '0:now,now2 | -1:lead1 | -2:lead2', shape);
  const end = cycles[0]?.range.end;
  check('cycle 10.–17. 9. is picked up Thursday 17. 9.', !!end && localText(end) === '2026-09-17 00:00', end && localText(end));
  const fromNext = groupFoodCornerOrdersByCycle(orders, -1, 'thursday', now).map((c) => c.offset).join(',');
  check('starting at next cycle drops this one', fromNext === '-1,-2', fromNext);
  const fromPast = groupFoodCornerOrdersByCycle(orders, 1, 'thursday', now).map((c) => c.offset).join(',');
  check('starting at previous cycle includes it', fromPast === '1,0,-1,-2', fromPast);
}

console.log('— checkout: one order per seller and lead time —');
{
  const item = (ref: string, unitRef: string, leadTimeWeeks: number) => ({ listing: { ref, unitRef, leadTimeWeeks }, qty: 1 });
  const groups = groupFoodCornerCheckout([
    item('a', 'farmA', 0),
    item('b', 'farmB', 0),
    item('c', 'farmA', 2),
    item('d', 'farmA', 0),
    item('e', 'farmA', 2),
    item('f', 'farmB', 1),
  ]);
  const shape = groups.map((g) => `${g.sellerRef}/${g.leadTimeWeeks}:${g.items.map((i) => i.listing.ref).join('')}`).join(' | ');
  check('split by seller and lead, first-seen order', shape === 'farmA/0:ad | farmB/0:b | farmA/2:ce | farmB/1:f', shape);
  const noLead = groupFoodCornerCheckout([
    { listing: { ref: 'a', unitRef: 'farmA' } },
    { listing: { ref: 'b', unitRef: 'farmA', leadTimeWeeks: 0 } },
  ]);
  check('no lead times = one order per seller', noLead.length === 1 && noLead[0].leadTimeWeeks === 0 && noLead[0].items.length === 2, noLead);
}

console.log('— Slovenian week plural —');
{
  const words = { one: 'teden', two: 'tedna', few: 'tedne', other: 'tednov' } as const;
  const want = ['tednov', 'teden', 'tedna', 'tedne', 'tedne', 'tednov', 'tednov', 'tednov', 'tednov', 'tednov', 'tednov', 'tednov', 'tednov'];
  for (let n = 0; n <= 12; n++) {
    const got = words[slovenianPluralForm(n)];
    check(`${n} ${want[n]}`, got === want[n], got);
  }
}

console.log(failures === 0 ? '\nAll assertions passed.' : `\n${failures} FAILED`);
process.exit(failures === 0 ? 0 : 1);
