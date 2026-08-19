import { test } from 'node:test';
import assert from 'node:assert/strict';
import { handleGetDaws, handleGetProjectInfo } from './project.js';
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

function textOf(result: Awaited<ReturnType<typeof handleGetDaws>>) {
  return JSON.parse((result.content[0] as { text: string }).text);
}

// --- get_daws ---

test('bitwig gets grid info from config; ableton always reports null (arbitrary note positioning)', async () => {
  const manager = {
    checkConnections: async () => [
      { daw: 'bitwig' as const, connected: true, isDefault: true },
      { daw: 'ableton' as const, connected: true, isDefault: false },
    ],
  } as unknown as DAWClientManager;

  const result = await handleGetDaws(fakeConfig(), manager);
  const parsed = textOf(result);

  const bitwig = parsed.daws.find((d: { daw: string }) => d.daw === 'bitwig');
  const ableton = parsed.daws.find((d: { daw: string }) => d.daw === 'ableton');
  assert.deepEqual(bitwig.grid, { resolution: 16, stepSize: 0.25, unit: '1/16th note' });
  assert.equal(ableton.grid, null);
});

test('summary hint differs for zero, one, and multiple connected DAWs', async () => {
  const zero = { checkConnections: async () => [{ daw: 'bitwig' as const, connected: false, isDefault: true }] } as unknown as DAWClientManager;
  const one = { checkConnections: async () => [{ daw: 'bitwig' as const, connected: true, isDefault: true }] } as unknown as DAWClientManager;
  const both = {
    checkConnections: async () => [
      { daw: 'bitwig' as const, connected: true, isDefault: true },
      { daw: 'ableton' as const, connected: true, isDefault: false },
    ],
  } as unknown as DAWClientManager;

  assert.match(textOf(await handleGetDaws(fakeConfig(), zero)).summary.hint, /No DAWs connected/);
  assert.match(textOf(await handleGetDaws(fakeConfig(), one)).summary.hint, /Only bitwig is connected/);
  assert.match(textOf(await handleGetDaws(fakeConfig(), both)).summary.hint, /Multiple DAWs connected/);
});

test('get_daws surfaces a connection-check failure as an error result instead of throwing', async () => {
  const manager = { checkConnections: async () => { throw new Error('socket boom'); } } as unknown as DAWClientManager;
  const result = await handleGetDaws(fakeConfig(), manager);

  assert.equal(result.isError, true);
  assert.match((result.content[0] as { text: string }).text, /socket boom/);
});

// --- get_project_info ---

test('get_project_info passes the DAW response straight through', async () => {
  const manager = { send: async () => ({ bpm: 128, timeSignatureNumerator: 4 }) } as unknown as DAWClientManager;
  const ctx: HandlerContext = { dawManager: manager, config: fakeConfig(), daw: 'bitwig', args: {} };

  const result = await handleGetProjectInfo(ctx);
  assert.deepEqual(textOf(result), { bpm: 128, timeSignatureNumerator: 4 });
});
