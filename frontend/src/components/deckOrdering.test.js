import assert from 'node:assert/strict';
import test from 'node:test';
import { moveDeckEntry, sortMainDeckEntries } from './deckOrdering.js';

test('new monsters are placed before spells and traps without reordering each group', () => {
  const entries = [
    { card_id: 'monster-one', quantity: 1 },
    { card_id: 'spell-one', quantity: 1 },
    { card_id: 'trap-one', quantity: 1 },
    { card_id: 'monster-two', quantity: 1 }
  ];
  const cardsById = new Map([
    ['monster-one', { category: 'monster' }],
    ['monster-two', { category: 'monster' }],
    ['spell-one', { category: 'spell' }],
    ['trap-one', { category: 'trap' }]
  ]);

  assert.deepEqual(
    sortMainDeckEntries(entries, cardsById).map((entry) => entry.card_id),
    ['monster-one', 'monster-two', 'spell-one', 'trap-one']
  );
});

test('moving a card before or after a target keeps an exact insertion position', () => {
  const entries = ['monster-one', 'monster-two', 'spell-one', 'trap-one']
    .map((card_id) => ({ card_id, quantity: 1 }));

  assert.deepEqual(
    moveDeckEntry(entries, 'spell-one', 'monster-two').map((entry) => entry.card_id),
    ['monster-one', 'spell-one', 'monster-two', 'trap-one']
  );
  assert.deepEqual(
    moveDeckEntry(entries, 'monster-one', 'monster-two', true).map((entry) => entry.card_id),
    ['monster-two', 'monster-one', 'spell-one', 'trap-one']
  );
});
