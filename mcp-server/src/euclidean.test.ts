import { test } from 'node:test';
import assert from 'node:assert/strict';
import { patternsToNotes } from './euclidean.js';

test('tresillo (3,8) matches the documented [1,0,0,1,0,0,1,0] pattern', () => {
  // lengthBeats=8 over 8 steps -> stepSize=1, so hit indices are the x positions directly.
  const notes = patternsToNotes([{ hits: 3, steps: 8, pitch: 36 }], 8);

  assert.deepEqual(notes.map(n => n.x), [0, 3, 6]);
  assert.ok(notes.every(n => n.y === 36 && n.velocity === 100 && n.duration === 1));
});

test('rotate shifts which steps are hit', () => {
  // (3,8) has no rotational symmetry, unlike evenly-spaced patterns - safe to
  // assert the rotation actually changes which steps land.
  const base = patternsToNotes([{ hits: 3, steps: 8, pitch: 37 }], 8).map(n => n.x);
  const rotated = patternsToNotes([{ hits: 3, steps: 8, pitch: 37, rotate: 1 }], 8).map(n => n.x);

  assert.notDeepEqual(rotated, base);
  assert.equal(rotated.length, base.length);
});

test('multiple patterns layer into one note list', () => {
  const notes = patternsToNotes(
    [
      { hits: 4, steps: 16, pitch: 36, velocity: 100 },
      { hits: 7, steps: 16, pitch: 38, velocity: 80 },
    ],
    4
  );

  assert.equal(notes.filter(n => n.y === 36).length, 4);
  assert.equal(notes.filter(n => n.y === 38).length, 7);
});
