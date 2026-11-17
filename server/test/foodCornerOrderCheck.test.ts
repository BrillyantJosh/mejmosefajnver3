/**
 * The server's check of a Točka obilja order before it is published
 * (Brilly, 17. 11. 2026): old orders still go out as before; a margin order
 * goes out only with the Točka's margin and the amount it gives.
 *   npm run test:points-margin
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { checkFoodCornerOrder, orderMarginProblem, type RelayRead } from '../lib/foodCornerOrderCheck.js';
import { marginTags } from '../../src/lib/foodCornerMargin.js';

const BUYER = 'c'.repeat(64);
const FARM = 'f'.repeat(64);
const POINT = 'b'.repeat(64);
const LINES = [{ price: '2.35', qty: '2.5' }, { price: '3.90', qty: '2' }, { price: '7.99', qty: '1' }];

function order(margin: number, change: (tags: string[][]) => string[][] = (tags) => tags) {
  return {
    kind: 36601,
    pubkey: BUYER,
    created_at: 1_794_000_000,
    tags: change([
      ['d', 'o-2026-11-17-abcdef12'],
      ['a', `30901:${FARM}:farm`],
      ['buyer_type', 'individual'],
      ...LINES.map((l, i) => ['item', `36500:${FARM}:x${i}`, l.qty, 'kg', l.price, 'EUR', `x${i}`]),
      ['total', '21.66', 'EUR'],
      ...marginTags(LINES, margin, 'EUR'),
      ['status', 'placed'],
      ['fulfillment', 'distribution_point'],
      ['distribution_point', `30905:${POINT}:tocka`],
      ['payment', 'lana_pay'],
      ['paid', 'false'],
    ]),
  };
}
const point = (tags: string[][], created_at = 100) => ({ kind: 30905, pubkey: POINT, created_at, tags: [['d', 'tocka'], ['name', 'Točka'], ...tags] });
const relays = (events: ReturnType<typeof point>[], answered = 2): RelayRead => async () => ({ events, answered });
const code = (r: Awaited<ReturnType<typeof checkFoodCornerOrder>>) => (r.ok ? 'ok' : (r as { code: string }).code);

describe('an order of before', () => {
  it('to a Točka without a margin goes out exactly as before', async () => {
    assert.equal(code(await checkFoodCornerOrder(order(0), relays([point([])]))), 'ok');
    assert.equal(code(await checkFoodCornerOrder(order(0), relays([point([['margin_percent', '0']])]))), 'ok');
  });
  it('to a Točka the relays do not hold still goes out as before', async () => {
    assert.equal(code(await checkFoodCornerOrder(order(0), relays([]))), 'ok');
  });
  it('to a Točka that now has a margin is refused (an old page open in a browser)', async () => {
    assert.equal(code(await checkFoodCornerOrder(order(0), relays([point([['margin_percent', '20']])]))), 'FOOD_CORNER_MARGIN_CHANGED');
  });
  it('anything that is not a Točka order is not read at all', async () => {
    const never: RelayRead = async () => { throw new Error('read'); };
    assert.equal(code(await checkFoodCornerOrder({ kind: 1, pubkey: BUYER, created_at: 1, tags: [] }, never)), 'ok');
    assert.equal(code(await checkFoodCornerOrder(order(0, (tags) => tags.filter((t) => t[0] !== 'distribution_point')), never)), 'ok');
  });
});

describe('a margin order', () => {
  it('with the Točka\'s margin and the amount it gives goes out', async () => {
    assert.equal(code(await checkFoodCornerOrder(order(20), relays([point([['margin_percent', '20']])]))), 'ok');
  });
  it('the newest Točka record decides', async () => {
    const older = point([], 100), newer = point([['margin_percent', '20']], 200);
    assert.equal(code(await checkFoodCornerOrder(order(20), relays([older, newer]))), 'ok');
    assert.equal(code(await checkFoodCornerOrder(order(0), relays([newer, older]))), 'FOOD_CORNER_MARGIN_CHANGED');
  });
  it('to a Točka with another margin, or none, is refused', async () => {
    assert.equal(code(await checkFoodCornerOrder(order(20), relays([point([['margin_percent', '10']])]))), 'FOOD_CORNER_MARGIN_CHANGED');
    assert.equal(code(await checkFoodCornerOrder(order(20), relays([point([])]))), 'FOOD_CORNER_MARGIN_CHANGED');
  });
  it('with a forged amount to pay, higher or lower, is refused', () => {
    for (const forged of ['26.01', '25.99', '21.66', '260.00', '26']) {
      const event = order(20, (tags) => tags.map((t) => (t[0] === 'pay_total' ? ['pay_total', forged, 'EUR'] : t)));
      assert.equal(code(orderMarginProblem(event, 20)), 'FOOD_CORNER_PAY_TOTAL_MISMATCH', forged);
    }
    const otherCurrency = order(20, (tags) => tags.map((t) => (t[0] === 'pay_total' ? ['pay_total', '26.00', 'USD'] : t)));
    assert.equal(code(orderMarginProblem(otherCurrency, 20)), 'FOOD_CORNER_PAY_TOTAL_MISMATCH');
    const noPay = order(20, (tags) => tags.filter((t) => t[0] !== 'pay_total'));
    assert.equal(code(orderMarginProblem(noPay, 20)), 'FOOD_CORNER_PAY_TOTAL_MISMATCH');
  });
  it('with a margin that cannot be read, or two amounts, is refused', () => {
    const bad = order(0, (tags) => [...tags, ['margin_percent', '25']]);
    assert.equal(code(orderMarginProblem(bad, 20)), 'FOOD_CORNER_ORDER_MARGIN_INVALID');
    const twice = order(20, (tags) => [...tags, ['pay_total', '26.00', 'EUR']]);
    assert.equal(code(orderMarginProblem(twice, 20)), 'FOOD_CORNER_ORDER_MARGIN_INVALID');
    const strayPay = order(0, (tags) => [...tags, ['pay_total', '21.66', 'EUR']]);
    assert.equal(code(orderMarginProblem(strayPay, 0)), 'FOOD_CORNER_ORDER_MARGIN_INVALID');
  });
});

describe('the Točka', () => {
  it('whose margin cannot be read takes no orders at all', async () => {
    assert.equal(code(await checkFoodCornerOrder(order(0), relays([point([['margin_percent', '30']])]))), 'FOOD_CORNER_POINT_MARGIN_UNREADABLE');
    assert.equal(code(await checkFoodCornerOrder(order(0), relays([point([['margin_percent', '5'], ['margin_percent', '5']])]))), 'FOOD_CORNER_POINT_MARGIN_UNREADABLE');
  });
  it('that cannot be read refuses nothing new: an order of before goes out as before', async () => {
    assert.equal(code(await checkFoodCornerOrder(order(0), relays([], 0))), 'ok');
    const failing: RelayRead = async () => { throw new Error('relays down'); };
    assert.equal(code(await checkFoodCornerOrder(order(0), failing)), 'ok');
  });
  it('that cannot be read still holds a margin order to its own arithmetic', async () => {
    assert.equal(code(await checkFoodCornerOrder(order(20), relays([], 0))), 'ok');
    const forged = order(20, (tags) => tags.map((t) => (t[0] === 'pay_total' ? ['pay_total', '30.00', 'EUR'] : t)));
    assert.equal(code(await checkFoodCornerOrder(forged, relays([], 0))), 'FOOD_CORNER_PAY_TOTAL_MISMATCH');
    assert.equal(code(await checkFoodCornerOrder(forged, relays([]))), 'FOOD_CORNER_PAY_TOTAL_MISMATCH');
  });
});
