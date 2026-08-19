import { test } from 'node:test';
import assert from 'node:assert/strict';
import { toInternal, toUser, quantizeForBitwig } from './indices.js';
import type { Config } from '../config.js';

test('toInternal/toUser round-trip 1-based <-> 0-based', () => {
  assert.equal(toInternal(1), 0);
  assert.equal(toUser(0), 1);
  assert.equal(toUser(toInternal(5)), 5);
});

test('quantizeForBitwig snaps beats to the configured grid', () => {
  const config = { gridResolution: 16 } as Config; // stepSize = 4/16 = 0.25

  assert.equal(quantizeForBitwig(0.26, config), 0.25);
  assert.equal(quantizeForBitwig(0.4, config), 0.5);
  assert.equal(quantizeForBitwig(2, config), 2);
});
