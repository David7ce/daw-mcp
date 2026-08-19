import { test } from 'node:test';
import assert from 'node:assert/strict';
import { resolveDaw } from './daw-resolution.js';
import type { DAWClientManager } from '../daw-client.js';

function fakeManager(connections: Array<{ daw: 'bitwig' | 'ableton'; connected: boolean }>) {
  return { checkConnections: async () => connections } as unknown as DAWClientManager;
}

test('an explicit daw parameter always wins, even if that DAW is not connected', async () => {
  const manager = fakeManager([{ daw: 'bitwig', connected: false }, { daw: 'ableton', connected: true }]);
  const result = await resolveDaw('bitwig', manager, 'ableton');
  assert.equal(result, 'bitwig');
});

test('with nothing explicit, a single connected DAW is auto-selected over the config default', async () => {
  const manager = fakeManager([{ daw: 'bitwig', connected: false }, { daw: 'ableton', connected: true }]);
  const result = await resolveDaw(undefined, manager, 'bitwig'); // config default is bitwig, but only ableton is up
  assert.equal(result, 'ableton');
});

test('with both DAWs connected, falls back to the config default', async () => {
  const manager = fakeManager([{ daw: 'bitwig', connected: true }, { daw: 'ableton', connected: true }]);
  const result = await resolveDaw(undefined, manager, 'ableton');
  assert.equal(result, 'ableton');
});

test('with no DAWs connected, falls back to the config default', async () => {
  const manager = fakeManager([{ daw: 'bitwig', connected: false }, { daw: 'ableton', connected: false }]);
  const result = await resolveDaw(undefined, manager, 'bitwig');
  assert.equal(result, 'bitwig');
});
