/**
 * Točka obilja margin (Brilly, 17. 11. 2026): the arithmetic, the records and
 * what every page shows the buyer and the Točka. Pure, no React, no network.
 *   npm run test:points-margin
 *
 * scripts/pointsMargin.vectors.json is a byte-identical copy of letsbalance-world
 * apps/universal/tests/points-margin.vectors.json: both apps must give the same
 * amount to pay for the same order, to the cent.
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  FOOD_CORNER_MAX_MARGIN,
  centsText,
  lineCentsOf,
  marginOfTags,
  marginTags,
  parseMarginPercent,
  payTotalCents,
  priceTextCents,
  withMarginCents,
} from './foodCornerMargin';
import {
  foodCornerLinePay,
  foodCornerOrderPay,
  foodCornerUnitPay,
  parseFoodCornerAllocation,
  parseFoodCornerNode,
  parseFoodCornerOrder,
} from './foodCorner';

type Vectors = {
  maxPercent: number;
  marginPercent: [string | null, number | null][];
  unitPrice: { why: string; cents: number; margin: number; pay: number }[];
  line: { why: string; unitPay: number; qty: string; pay: number }[];
  orders: { why: string; margin: number; currency: string; items: [string, string][]; payTotal: string }[];
};
const vectors: Vectors = JSON.parse(readFileSync(new URL('../../scripts/pointsMargin.vectors.json', import.meta.url), 'utf8'));

const BUYER = 'c'.repeat(64);
const FARM = 'f'.repeat(64);
const POINT = 'b'.repeat(64);
const POINT_REF = `30905:${POINT}:tocka`;
const ITEMS: [string, string, string, string][] = [
  // listing d, qty, unit, price — the example Brilly approved
  ['apples', '2.5', 'kg', '2.35'],
  ['bread', '2', 'kos', '3.90'],
  ['honey', '1', 'kos', '7.99'],
];

/** A KIND 36601 as the order page writes it (supplier prices; margin tags after `total`). */
function orderEvent(margin: number, extra: string[][] = [], total = '21.66') {
  const items = ITEMS.map(([d, qty, unit, price]) => ['item', `36500:${FARM}:${d}`, qty, unit, price, 'EUR', d]);
  const lines = ITEMS.map(([, qty, , price]) => ({ price, qty }));
  return {
    id: 'o'.repeat(64),
    pubkey: BUYER,
    created_at: 1_794_000_000,
    kind: 36601,
    content: '',
    tags: [
      ['d', 'o-2026-11-17-abcdef12'],
      ['a', `30901:${FARM}:farm`],
      ['buyer_type', 'individual'],
      ...items,
      ['total', total, 'EUR'],
      ...marginTags(lines, margin, 'EUR'),
      ['status', 'placed'],
      ['fulfillment', 'distribution_point'],
      ['distribution_point', POINT_REF],
      ['payment', 'lana_pay'],
      ['paid', 'false'],
      ...extra,
    ],
  };
}
const read = (event: ReturnType<typeof orderEvent>) => parseFoodCornerOrder(event, new Map())!;

describe('the shared vectors (same as LetsBalance)', () => {
  it('reads the margin tag: absent or 0 = 1:1, 1–20 whole percent, anything else closes the Točka', () => {
    assert.equal(FOOD_CORNER_MAX_MARGIN, vectors.maxPercent);
    for (const [raw, want] of vectors.marginPercent) assert.equal(parseMarginPercent(raw), want, JSON.stringify(raw));
  });
  it('puts the margin on each unit price in whole cents, half a cent up', () => {
    for (const v of vectors.unitPrice) assert.equal(withMarginCents(v.cents, v.margin), v.pay, v.why);
  });
  it('multiplies by the quantity, half a cent up', () => {
    for (const v of vectors.line) assert.equal(lineCentsOf(v.unitPay, v.qty), v.pay, v.why);
  });
  it('gives the same amount to pay for each whole order', () => {
    for (const o of vectors.orders) {
      const cents = payTotalCents(o.items.map(([price, qty]) => ({ price, qty })), o.margin);
      assert.equal(cents === null ? null : centsText(cents), o.payTotal, o.why);
    }
  });
});

describe('the arithmetic beyond the shared vectors', () => {
  it('reads prices with one or two decimals, nothing else', () => {
    assert.equal(priceTextCents('2.35'), 235);
    assert.equal(priceTextCents('4'), 400);
    assert.equal(priceTextCents('0.5'), 50);
    assert.equal(priceTextCents('2.345'), null);
    assert.equal(priceTextCents('-1'), null);
    assert.equal(priceTextCents('1e3'), null);
  });
  it('counts quantities typed with more decimals exactly (MejmoSeFajn allows them)', () => {
    assert.equal(lineCentsOf(282, '0.333'), 94); // 93.906
    assert.equal(lineCentsOf(1000, '0.0005'), 1); // 0.5 cent goes up
    assert.equal(lineCentsOf(1000, '0.0004'), 0);
    assert.equal(lineCentsOf(282, '1e-7'), null);
    assert.equal(lineCentsOf(282, ''), null);
  });
  it('two margin tags are none of them', () => {
    assert.equal(marginOfTags([['margin_percent', '10'], ['margin_percent', '10']]), null);
    assert.equal(marginOfTags([['d', 'x']]), 0);
  });
  it('writes no tags at all without a margin, and refuses an order it cannot price', () => {
    assert.deepEqual(marginTags([{ price: '2.35', qty: '2.5' }], 0, 'EUR'), []);
    assert.deepEqual(marginTags([{ price: '2.35', qty: '2.5' }], 20, 'EUR'), [['margin_percent', '20'], ['pay_total', '7.05', 'EUR']]);
    assert.throws(() => marginTags([{ price: '2.345', qty: '1' }], 20, 'EUR'));
  });
});

describe('the Točka record', () => {
  const node = (...extra: string[][]) =>
    parseFoodCornerNode({ id: 'n', pubkey: POINT, created_at: 1, kind: 30905, content: '', tags: [['d', 'tocka'], ['name', 'Točka'], ...extra] })!;
  it('a Točka of before has no margin; 20 is 20; 21 or garbage cannot be read', () => {
    assert.equal(node().marginPercent, 0);
    assert.equal(node(['margin_percent', '20']).marginPercent, 20);
    assert.equal(node(['margin_percent', '21']).marginPercent, null);
    assert.equal(node(['margin_percent', 'abc']).marginPercent, null);
  });
});

describe('what the buyer pays (every page goes through foodCornerOrderPay)', () => {
  it('an order of before is exactly what it was, to the float cent it always showed', () => {
    const event = orderEvent(0);
    assert.ok(!event.tags.some((tag) => tag[0] === 'margin_percent' || tag[0] === 'pay_total'));
    const pay = foodCornerOrderPay(read(event));
    assert.deepEqual(pay, { amount: 21.66, suppliers: 21.66, currency: 'EUR', margin: 0, mismatch: false });
    // Unit and line amounts on the pages are untouched without a margin.
    assert.equal(foodCornerUnitPay(2.35, 0), 2.35);
    assert.equal(foodCornerLinePay(2.35, 2.5, 0), 2.35 * 2.5);
  });
  it('20 %: the suppliers get their total, the buyer pays 26.00 €', () => {
    const event = orderEvent(20);
    const at = event.tags.findIndex((tag) => tag[0] === 'total');
    assert.deepEqual(event.tags.slice(at, at + 3), [['total', '21.66', 'EUR'], ['margin_percent', '20'], ['pay_total', '26.00', 'EUR']]);
    assert.deepEqual(foodCornerOrderPay(read(event)), { amount: 26, suppliers: 21.66, currency: 'EUR', margin: 20, mismatch: false });
    assert.equal(foodCornerUnitPay(7.99, 20), 9.59);
    assert.equal(foodCornerLinePay(2.35, 2.5, 20), 7.05);
  });
  it('a forged or missing amount to pay is never shown as such: the computed one is, marked', () => {
    for (const forged of ['27.00', '21.66', '0.01']) {
      const event = orderEvent(20);
      event.tags = event.tags.map((tag) => (tag[0] === 'pay_total' ? ['pay_total', forged, 'EUR'] : tag));
      const pay = foodCornerOrderPay(read(event));
      assert.equal(pay.amount, 26, forged);
      assert.equal(pay.mismatch, true, forged);
    }
    const missing = orderEvent(20);
    missing.tags = missing.tags.filter((tag) => tag[0] !== 'pay_total');
    assert.equal(foodCornerOrderPay(read(missing)).mismatch, true);
  });
  it('an order whose margin cannot be read is marked and shown at the suppliers\' prices', () => {
    const event = orderEvent(0, [['margin_percent', '99']]);
    const pay = foodCornerOrderPay(read(event));
    assert.equal(pay.mismatch, true);
    assert.equal(pay.amount, 21.66);
  });
  it('a Točka allocation of a margin order is paid with the order\'s margin on the allocated quantities', () => {
    const order = read(orderEvent(20));
    // No honey came: 26.00 − 9.59.
    const alloc = parseFoodCornerAllocation({
      id: 'a', pubkey: POINT, created_at: 2, kind: 36603, content: '',
      tags: [
        ['d', order.dTag], ['a', order.ref], ['p', BUYER], ['distribution_point', POINT_REF],
        ['alloc', `36500:${FARM}:apples`, '2.5', 'kg', '2.35', 'EUR'],
        ['alloc', `36500:${FARM}:bread`, '2', 'kos', '3.90', 'EUR'],
        ['alloc', `36500:${FARM}:honey`, '0', 'kos', '7.99', 'EUR'],
        ['total', '13.68', 'EUR'],
        ...marginTags([{ price: '2.35', qty: '2.5' }, { price: '3.90', qty: '2' }, { price: '7.99', qty: '0' }], 20, 'EUR'),
      ],
    })!;
    assert.equal(alloc.payTotalRecorded, '16.41');
    const pay = foodCornerOrderPay({ ...order, allocation: alloc });
    assert.deepEqual(pay, { amount: 16.41, suppliers: 13.68, currency: 'EUR', margin: 20, mismatch: false });
    // An allocation written by an older Točka page (no pay_total) is still paid with the margin, unmarked.
    const older = { ...alloc, payTotalRecorded: '' };
    assert.deepEqual(foodCornerOrderPay({ ...order, allocation: older }), { amount: 16.41, suppliers: 13.68, currency: 'EUR', margin: 20, mismatch: false });
  });
  it('an allocation of an order of before stays exactly what it was', () => {
    const order = read(orderEvent(0));
    const alloc = parseFoodCornerAllocation({
      id: 'a', pubkey: POINT, created_at: 2, kind: 36603, content: '',
      tags: [['d', order.dTag], ['a', order.ref], ['p', BUYER], ['alloc', `36500:${FARM}:apples`, '1', 'kg', '2.35', 'EUR'], ['total', '2.35', 'EUR']],
    })!;
    assert.deepEqual(foodCornerOrderPay({ ...order, allocation: alloc }), { amount: 2.35, suppliers: 2.35, currency: 'EUR', margin: 0, mismatch: false });
  });
});
