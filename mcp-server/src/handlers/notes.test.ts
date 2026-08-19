import { test } from 'node:test';
import assert from 'node:assert/strict';
import { handleBatchSetNotes, handleBatchGetNotes } from './notes.js';
import type { HandlerContext } from './types.js';
import type { DAWClientManager } from '../daw-client.js';
import type { Config } from '../config.js';

function fakeConfig(): Config {
  return {
    defaultDaw: 'ableton',
    gridResolution: 16,
    bitwig: { port: 8181, cursorClipLengthBeats: 128, scenes: 128 },
    ableton: { port: 8182 },
    mcp: { selectionDelayMs: 0, requestTimeoutMs: 1000 },
    tools: {},
  };
}

/** Records every dawManager.send call and answers with canned results per method. */
function fakeDawManager(responses: Record<string, unknown>) {
  const calls: Array<{ method: string; params?: Record<string, unknown> }> = [];
  const send = async (method: string, params?: Record<string, unknown>) => {
    calls.push({ method, params });
    return responses[method] ?? {};
  };
  return { manager: { send } as unknown as DAWClientManager, calls };
}

test('batch_set_notes converts the ultra-lean array format to note objects (Ableton)', async () => {
  const { manager, calls } = fakeDawManager({ 'clip.hasContent': { hasContent: true } });
  const ctx: HandlerContext = {
    dawManager: manager,
    config: fakeConfig(),
    daw: 'ableton',
    args: { trackIndex: 1, slotIndex: 1, notes: [[0, 60, 100, 0.5], [4, 64, 80, 0.25]] },
  };

  const result = await handleBatchSetNotes(ctx);

  assert.equal(result.isError, undefined);
  const setNotesCall = calls.find(c => c.method === 'clip.setNotes');
  assert.ok(setNotesCall, 'expected a clip.setNotes call');
  assert.deepEqual(setNotesCall!.params!.notes, [
    { x: 0, y: 60, velocity: 100, duration: 0.5 },
    { x: 4, y: 64, velocity: 80, duration: 0.25 },
  ]);
});

test('batch_set_notes quantizes positions to the grid for Bitwig, one clip.setNote per note', async () => {
  const { manager, calls } = fakeDawManager({ 'clip.hasContent': { hasContent: true } });
  const ctx: HandlerContext = {
    dawManager: manager,
    config: fakeConfig(),
    daw: 'bitwig',
    args: { trackIndex: 1, slotIndex: 1, notes: [[0.26, 60, 100, 0.4]] }, // gridResolution=16 -> step 0.25
  };

  const result = await handleBatchSetNotes(ctx);

  assert.equal(result.isError, undefined);
  const setNoteCalls = calls.filter(c => c.method === 'clip.setNote');
  assert.equal(setNoteCalls.length, 1);
  assert.equal(setNoteCalls[0].params!.x, 0.25);
  assert.equal(setNoteCalls[0].params!.duration, 0.5);
});

test('batch_get_notes returns the ultra-lean array format by default', async () => {
  const { manager } = fakeDawManager({
    'clip.hasContent': { hasContent: true },
    'clip.getNotes': { notes: [{ x: 4, y: 64, velocity: 0.5, duration: 0.333 }, { x: 0, y: 60, velocity: 1, duration: 0.5 }] },
  });
  const ctx: HandlerContext = {
    dawManager: manager,
    config: fakeConfig(),
    daw: 'ableton',
    args: { trackIndex: 1, slotIndex: 1 },
  };

  const result = await handleBatchGetNotes(ctx);
  const parsed = JSON.parse((result.content[0] as { text: string }).text);

  // Sorted by x ascending, velocity scaled to 0-127, duration rounded to 2dp
  assert.deepEqual(parsed.clips[0].notes, [
    [0, 60, 127, 0.5],
    [4, 64, 64, 0.33],
  ]);
});
