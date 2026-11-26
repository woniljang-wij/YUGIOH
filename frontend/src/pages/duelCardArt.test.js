import assert from 'node:assert/strict';
import test from 'node:test';
import { getRetriedDuelCardArtworkSource } from './duelCardArt.js';

test('does not alter artwork sources before a retry', () => {
  const source = '/assets/images/artwork/Blue-Eyes%20White%20Dragon.png';

  assert.equal(getRetriedDuelCardArtworkSource(source, 0), source);
});

test('adds a cache-busting retry parameter before URL fragments', () => {
  assert.equal(
    getRetriedDuelCardArtworkSource('/artwork/card.png?size=small#preview', 1),
    '/artwork/card.png?size=small&_duelImageRetry=1#preview'
  );
});
