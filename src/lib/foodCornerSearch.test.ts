/**
 * The search field above the offers on /food-corner (order tab): what it finds
 * and what it does not. Pure, no React, no network.
 *   npm run test:food-search
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { normalizeSearchText, offerMatchesSearch } from './foodCornerSearch';

type Offer = { title: string; supplier?: string };

const OFFERS: Offer[] = [
  { title: 'GRANATNO JABOLKO', supplier: 'EKOLOŠKA POSEST ZAKLADNICA DOBRIH IDEJ' },
  { title: 'Bela redkev', supplier: 'EKOLOŠKA POSEST ZAKLADNICA DOBRIH IDEJ' },
  { title: 'Česen', supplier: 'Kmetija Nabernik' },
  { title: 'Domač med', supplier: 'Čebelarstvo Žnidaršič' },
  { title: 'Mleko', supplier: undefined },
];

const search = (query: string): string[] => {
  const q = normalizeSearchText(query);
  return OFFERS.filter((o) => offerMatchesSearch(q, o.title, o.supplier)).map((o) => o.title);
};

describe('normalizeSearchText', () => {
  it('lower-cases, strips Slovene/Croatian diacritics, squeezes and trims spaces', () => {
    assert.equal(normalizeSearchText('  ČEŠNJA   Žito  '), 'cesnja zito');
    assert.equal(normalizeSearchText('Đurđevak ćevapi'), 'durdevak cevapi');
    assert.equal(normalizeSearchText(''), '');
  });
});

describe('offerMatchesSearch', () => {
  it('finds a product by a part of its name, case-insensitively', () => {
    assert.deepEqual(search('granatno'), ['GRANATNO JABOLKO']);
    assert.deepEqual(search('GRANATNO jabolko'), ['GRANATNO JABOLKO']);
    assert.deepEqual(search('jabol'), ['GRANATNO JABOLKO']);
  });

  it('ignores diacritics in both directions', () => {
    assert.deepEqual(search('cesen'), ['Česen']);
    assert.deepEqual(search('ČESEN'), ['Česen']);
    assert.deepEqual(search('znidarsic'), ['Domač med']);
    assert.deepEqual(search('domac'), ['Domač med']);
  });

  it('finds every offer of a supplier by the supplier name', () => {
    assert.deepEqual(search('zakladnica'), ['GRANATNO JABOLKO', 'Bela redkev']);
    assert.deepEqual(search('ZAKLADNICA DOBRIH IDEJ'), ['GRANATNO JABOLKO', 'Bela redkev']);
    assert.deepEqual(search('nabernik'), ['Česen']);
  });

  it('trims spaces around the text', () => {
    assert.deepEqual(search('   granatno  '), ['GRANATNO JABOLKO']);
  });

  it('shows everything for an empty or blank query', () => {
    assert.equal(search('').length, OFFERS.length);
    assert.equal(search('   ').length, OFFERS.length);
  });

  it('shows nothing when nothing matches', () => {
    assert.deepEqual(search('banana'), []);
    // the supplier-less offer can only match by its own name
    assert.deepEqual(search('mlek'), ['Mleko']);
  });

  it('does not match on other fields: the "·" city part or the description are not searched', () => {
    assert.deepEqual(search('semic'), []);
  });
});
