import { test } from 'node:test';
import assert from 'node:assert/strict';
import { handleBatchCreateTracks, handleBatchDeleteTracks, handleBatchSetTrackProperties } from './tracks.js';
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

/**
 * Records every dawManager.send call. `responses[method]` may be a single
 * value (returned every time) or an array (consumed in call order, last
 * entry repeats once exhausted) - needed because batch_create_tracks calls
 * track.list twice per track with different before/after snapshots.
 */
function fakeDawManager(responses: Record<string, unknown | unknown[]>) {
  const calls: Array<{ method: string; params?: Record<string, unknown> }> = [];
  const callCounts: Record<string, number> = {};
  const send = async (method: string, params?: Record<string, unknown>) => {
    calls.push({ method, params });
    const entry = responses[method];
    if (Array.isArray(entry)) {
      const i = callCounts[method] ?? 0;
      callCounts[method] = i + 1;
      return entry[Math.min(i, entry.length - 1)] ?? {};
    }
    return entry ?? {};
  };
  return { manager: { send } as unknown as DAWClientManager, calls };
}

test('batch_create_tracks diffs track.list before/after to find the new index when Bitwig returns no index (append)', async () => {
  const { manager, calls } = fakeDawManager({
    'track.list': [
      { tracks: [{ index: 0, name: 'A' }, { index: 1, name: 'B' }] },
      { tracks: [{ index: 0, name: 'A' }, { index: 1, name: 'B' }, { index: 2, name: 'Inst 2' }] },
    ],
    'track.create': {}, // no index - Bitwig fire-and-forget
  });
  const ctx: HandlerContext = {
    dawManager: manager,
    config: fakeConfig(),
    daw: 'bitwig',
    args: { tracks: [{ type: 'instrument' }] },
  };

  const result = await handleBatchCreateTracks(ctx);
  const parsed = JSON.parse((result.content[0] as { text: string }).text);

  assert.equal(parsed.success, true);
  assert.deepEqual(parsed.createdIndices, [3]); // 1-based
  assert.equal(calls.filter(c => c.method === 'track.list').length, 2);
});

test('batch_create_tracks finds the new index when it lands in the middle, not just appended', async () => {
  const { manager } = fakeDawManager({
    'track.list': [
      { tracks: [{ index: 0, name: 'A' }, { index: 1, name: 'B' }, { index: 2, name: 'C' }] },
      { tracks: [{ index: 0, name: 'A' }, { index: 1, name: 'Inst 4' }, { index: 2, name: 'B' }, { index: 3, name: 'C' }] },
    ],
    'track.create': {},
  });
  const ctx: HandlerContext = {
    dawManager: manager,
    config: fakeConfig(),
    daw: 'bitwig',
    args: { tracks: [{ type: 'instrument', position: 2 }] }, // 1-based position 2 -> internal index 1
  };

  const result = await handleBatchCreateTracks(ctx);
  const parsed = JSON.parse((result.content[0] as { text: string }).text);

  assert.deepEqual(parsed.createdIndices, [2]); // 1-based internal index 1
});

test('batch_create_tracks uses the synchronous index directly when the DAW returns one (Ableton), skipping the diff re-query', async () => {
  const { manager, calls } = fakeDawManager({
    'track.list': { tracks: [{ index: 0, name: 'A' }] },
    'track.create': { index: 1 }, // Ableton returns index synchronously
  });
  const ctx: HandlerContext = {
    dawManager: manager,
    config: fakeConfig(),
    daw: 'ableton',
    args: { tracks: [{ type: 'instrument', name: 'Bass' }] },
  };

  const result = await handleBatchCreateTracks(ctx);
  const parsed = JSON.parse((result.content[0] as { text: string }).text);

  assert.deepEqual(parsed.createdIndices, [2]); // 1-based
  // Only the single "before" snapshot call - no settle-delay re-query needed.
  assert.equal(calls.filter(c => c.method === 'track.list').length, 1);
  const setNameCall = calls.find(c => c.method === 'track.setName');
  assert.deepEqual(setNameCall!.params, { index: 1, name: 'Bass' });
});

test('batch_delete_tracks deletes in descending internal-index order regardless of input order', async () => {
  const { manager, calls } = fakeDawManager({ 'track.delete': {} });
  const ctx: HandlerContext = {
    dawManager: manager,
    config: fakeConfig(),
    daw: 'bitwig',
    args: { trackIndices: [2, 5, 3] }, // 1-based, unsorted
  };

  const result = await handleBatchDeleteTracks(ctx);
  const parsed = JSON.parse((result.content[0] as { text: string }).text);

  assert.equal(parsed.completed, 3);
  const deleteCalls = calls.filter(c => c.method === 'track.delete');
  assert.deepEqual(deleteCalls.map(c => c.params!.index), [4, 2, 1]); // 0-based, descending
});

test('batch_set_track_properties only calls setters for properties that were provided', async () => {
  const { manager, calls } = fakeDawManager({
    'track.setVolume': {},
    'track.setMute': {},
  });
  const ctx: HandlerContext = {
    dawManager: manager,
    config: fakeConfig(),
    daw: 'bitwig',
    args: { tracks: [{ index: 1, volume: 0.8, mute: true }] },
  };

  const result = await handleBatchSetTrackProperties(ctx);
  const parsed = JSON.parse((result.content[0] as { text: string }).text);

  assert.equal(parsed.completed, 1);
  assert.equal(calls.length, 2);
  assert.equal(calls.some(c => c.method === 'track.setName'), false);
  assert.equal(calls.some(c => c.method === 'track.setSolo'), false);
});
