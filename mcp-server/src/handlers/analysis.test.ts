import { test } from 'node:test';
import assert from 'node:assert/strict';
import { computeClipStats, handleGetClipStats } from './analysis.js';
import type { HandlerContext } from './types.js';
import type { DAWClientManager } from '../daw-client.js';
import type { Config } from '../config.js';

function fakeConfig(): Config {
  return {
    defaultDaw: 'bitwig',
    gridResolution: 16,
    bitwig: { port: 8181, cursorClipLengthBeats: 128, scenes: 128 },
    ableton: { port: 8182 },
    mcp: { selectionDelayMs: 0, requestTimeoutMs: 1000 },
    tools: {},
  };
}

function fakeDawManager(responses: Record<string, unknown>) {
  const send = async (method: string) => responses[method] ?? {};
  return { send } as unknown as DAWClientManager;
}

// --- computeClipStats ---

test('empty clip reports zeroed stats without touching pitch/velocity math', () => {
  const stats = computeClipStats([], 4, 0.25);

  assert.equal(stats.noteCount, 0);
  assert.equal(stats.pitchRange, null);
  assert.equal(stats.velocityRange, null);
  assert.equal(stats.durationRange, null);
  assert.equal(stats.density, 0);
  assert.deepEqual(stats.beatGrid, new Array(16).fill(0)); // ceil(4/0.25)
  assert.equal(stats.analysis, null);
});

test('computes pitch/velocity/duration ranges and the beat grid for a populated clip', () => {
  const notes = [
    { x: 0, y: 60, velocity: 1.0, duration: 0.5 },
    { x: 0.5, y: 64, velocity: 0.5, duration: 0.25 },
    { x: 1.0, y: 67, velocity: 0, duration: 0.25 },
  ];
  const stats = computeClipStats(notes, 4, 0.25);

  assert.deepEqual(stats.pitchRange, { min: 60, max: 67, span: 7 });
  assert.deepEqual(stats.pitchClasses, [0, 4, 7]);
  assert.deepEqual(stats.velocityRange, { min: 0, max: 127, avg: 64 }); // 0-1 -> 0-127
  assert.deepEqual(stats.durationRange, { min: 0.25, max: 0.5 });
  assert.equal(stats.gridResolution, 16); // configured resolution, from stepSize=0.25
  assert.equal(stats.density, 0.188); // 3 filled / 16 cells, rounded to 3dp
  assert.deepEqual(stats.beatGrid.slice(0, 5), [1, 0, 1, 0, 1]);
});

test('detects a coarser grid than configured when notes align to it exactly', () => {
  // Notes land on the 1/8 grid (step 0.5), not the finer configured 1/16 grid.
  const notes = [{ x: 0, y: 60, velocity: 1, duration: 0.5 }, { x: 0.5, y: 64, velocity: 1, duration: 0.5 }, { x: 1.0, y: 67, velocity: 1, duration: 0.5 }];
  const stats = computeClipStats(notes, 4, 0.25);

  assert.deepEqual(stats.detectedGrid, { resolution: 8, confidence: 1 });
});

test('falls back to the finest grid with low confidence for humanized (jittered) note positions', () => {
  const notes = [
    { x: 0.1, y: 60, velocity: 1, duration: 0.5 },
    { x: 1.35, y: 64, velocity: 1, duration: 0.5 },
    { x: 2.6, y: 67, velocity: 1, duration: 0.5 },
    { x: 3.87, y: 71, velocity: 1, duration: 0.5 },
  ];
  const stats = computeClipStats(notes, 4, 0.25);

  assert.deepEqual(stats.detectedGrid, { resolution: 64, confidence: 0.36 });
});

test('notes past the configured clip length are ignored by the beat grid, not out-of-bounds', () => {
  // clipLength=1 beat -> gridSlots = ceil(1/0.25) = 4; a note at x=2 is past the grid entirely.
  const notes = [{ x: 0, y: 60, velocity: 1, duration: 0.25 }, { x: 2, y: 64, velocity: 1, duration: 0.25 }];
  const stats = computeClipStats(notes, 1, 0.25);

  assert.equal(stats.beatGrid.length, 4);
  assert.deepEqual(stats.beatGrid, [1, 0, 0, 0]); // the x=2 note fell outside the grid, silently dropped
});

// --- handleGetClipStats (thin orchestration around computeClipStats) ---

function textOf(result: Awaited<ReturnType<typeof handleGetClipStats>>) {
  return JSON.parse((result.content[0] as { text: string }).text);
}

test('handleGetClipStats defaults clip length to 4 beats when the DAW omits it', async () => {
  const manager = fakeDawManager({
    'clip.getSelection': { trackIndex: 0, slotIndex: 0, hasContent: true },
    'clip.getNotes': { notes: [] }, // no clipLength field
  });
  const ctx: HandlerContext = { dawManager: manager, config: fakeConfig(), daw: 'bitwig', args: {} };

  const result = await handleGetClipStats(ctx);
  const parsed = textOf(result);

  assert.equal(parsed.lengthBeats, 4);
  assert.equal(parsed.noteCount, 0);
});

test('handleGetClipStats passes the configured grid resolution through as stepSize', async () => {
  const manager = fakeDawManager({
    'clip.getSelection': { trackIndex: 0, slotIndex: 0, hasContent: true },
    'clip.getNotes': { notes: [], clipLength: 8 },
  });
  const config = fakeConfig();
  config.gridResolution = 32; // stepSize = 4/32 = 0.125
  const ctx: HandlerContext = { dawManager: manager, config, daw: 'bitwig', args: {} };

  const result = await handleGetClipStats(ctx);
  const parsed = textOf(result);

  assert.equal(parsed.stepSize, 0.125);
  assert.equal(parsed.lengthBeats, 8);
});
