import { test } from 'node:test';
import assert from 'node:assert/strict';
import { analyzeMusic } from './music-analysis.js';

test('detects a C major triad, suggests C major first, and picks C as root', () => {
  const notes = [{ x: 0, y: 60 }, { x: 0, y: 64 }, { x: 0, y: 67 }]; // C4 E4 G4
  const result = analyzeMusic(notes, [0, 4, 7]);

  assert.equal(result.chords.length, 1);
  assert.deepEqual(result.chords[0], {
    beat: 0,
    midiNotes: [60, 64, 67],
    noteNames: ['C4', 'E4', 'G4'],
    chord: 'CM',
    type: 'major',
  });
  assert.equal(result.suggestedScales[0], 'C major');
  assert.equal(result.suggestedKey, 'C major');
  assert.equal(result.rootNote, 'C');
});

test('groups notes onto separate chords by beat', () => {
  const notes = [{ x: 0, y: 60 }, { x: 0, y: 64 }, { x: 0, y: 67 }, { x: 2, y: 65 }, { x: 2, y: 69 }, { x: 2, y: 72 }];
  const result = analyzeMusic(notes, [0, 1, 4, 5, 7, 9]);

  assert.equal(result.chords.length, 2);
  assert.deepEqual(result.chords.map(c => c.beat), [0, 2]); // sorted by beat
});

test('a single note has no detectable chord but still reports its name', () => {
  const result = analyzeMusic([{ x: 0, y: 62 }], [2]); // D4 alone

  assert.equal(result.chords[0].chord, null);
  assert.deepEqual(result.chords[0].noteNames, ['D4']);
});

test('fewer than 3 pitch classes yields no suggested key, but a root falls back to the raw pitch class', () => {
  const result = analyzeMusic([{ x: 0, y: 62 }], [2]); // just D

  assert.equal(result.suggestedKey, null);
  assert.equal(result.rootNote, 'D'); // falls back since no key was found
});

test('empty input returns all-empty analysis without throwing', () => {
  const result = analyzeMusic([], []);

  assert.deepEqual(result, {
    chords: [],
    suggestedScales: [],
    suggestedKey: null,
    rootNote: null,
  });
});

test('exact-duplicate MIDI notes within a beat are deduplicated and sorted', () => {
  const notes = [{ x: 0, y: 67 }, { x: 0, y: 60 }, { x: 0, y: 60 }, { x: 0, y: 64 }]; // 60 listed twice
  const result = analyzeMusic(notes, [0, 4, 7]);

  assert.deepEqual(result.chords[0].midiNotes, [60, 64, 67]); // sorted ascending, dupe removed
});
