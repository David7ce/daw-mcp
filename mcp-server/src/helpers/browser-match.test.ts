import { test } from 'node:test';
import assert from 'node:assert/strict';
import { selectBrowserMatch, BrowserResult } from './browser-match.js';

const results: BrowserResult[] = [
  { index: 0, name: 'Polysynth' },
  { index: 1, name: 'Polysynth Bass Kit' },
  { index: 2, name: 'Compressor' },
];

test('exact case-insensitive match wins over substring matches', () => {
  const outcome = selectBrowserMatch(results, 'polysynth');
  assert.equal(outcome.rule, 'exact');
  assert.equal(outcome.match?.name, 'Polysynth');
  assert.deepEqual(outcome.alternatives, []);
});

test('unique substring match is used when no exact match exists', () => {
  const outcome = selectBrowserMatch(results, 'compress');
  assert.equal(outcome.rule, 'unique-substring');
  assert.equal(outcome.match?.name, 'Compressor');
});

test('ambiguous substring matches pick the shortest name and report alternatives', () => {
  const outcome = selectBrowserMatch(results, 'poly');
  assert.equal(outcome.rule, 'shortest-substring');
  assert.equal(outcome.match?.name, 'Polysynth');
  assert.deepEqual(outcome.alternatives, ['Polysynth Bass Kit']);
});

test('no match returns null with rule "none"', () => {
  const outcome = selectBrowserMatch(results, 'nonexistent');
  assert.equal(outcome.rule, 'none');
  assert.equal(outcome.match, null);
});
