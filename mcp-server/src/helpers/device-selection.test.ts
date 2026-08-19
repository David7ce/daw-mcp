import { test } from 'node:test';
import assert from 'node:assert/strict';
import { selectTrackIfNeeded } from './device-selection.js';
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

function fakeDawManager() {
  const calls: Array<{ method: string; params?: Record<string, unknown> }> = [];
  const send = async (method: string, params?: Record<string, unknown>) => {
    calls.push({ method, params });
    return {};
  };
  return { manager: { send } as unknown as DAWClientManager, calls };
}

test('omitting trackIndex leaves the DAW cursor track alone', async () => {
  const { manager, calls } = fakeDawManager();
  await selectTrackIfNeeded(manager, fakeConfig(), 'bitwig', {});
  assert.equal(calls.length, 0);
});

test('an explicit trackIndex selects that track, converted from 1-based to 0-based', async () => {
  const { manager, calls } = fakeDawManager();
  await selectTrackIfNeeded(manager, fakeConfig(), 'bitwig', { trackIndex: 3 });
  assert.deepEqual(calls, [{ method: 'track.select', params: { index: 2 } }]);
});
